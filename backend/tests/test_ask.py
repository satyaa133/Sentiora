from uuid import UUID

from fastapi.testclient import TestClient

from app.core.db import SessionLocal
from app.main import app
from app.models.memory_chunk import MemoryChunk
from app.workers.jobs.process_capture import process_capture

client = TestClient(app)

ARTICLE = """
Introduction

Binary search repeatedly halves the search interval. It compares the target with the middle element, then continues on one side of the collection.

How it works

The algorithm starts with the full sorted array. If the middle value is too small, the search continues on the right half.
"""


def _auth_headers(email: str) -> dict[str, str]:
    password = "MemoryPassword123!"
    client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "full_name": "Ask Tester"},
    )
    login_resp = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    return {"Authorization": f"Bearer {login_resp.json()['data']['access_token']}"}


def _hashed_embed(texts: list[str]) -> list[list[float]]:
    dim = 1536
    vectors: list[list[float]] = []
    for text in texts:
        vec = [0.0] * dim
        for word in text.lower().split():
            vec[abs(hash(word)) % dim] += 1.0
        norm = sum(value * value for value in vec) ** 0.5 or 1.0
        vectors.append([value / norm for value in vec])
    return vectors


def _index_memory(email: str, title: str, url: str, content: str) -> tuple[dict[str, str], str]:
    headers = _auth_headers(email)
    create_resp = client.post(
        "/api/v1/memory-items",
        json={
            "source_type": "webpage",
            "url": url,
            "title": title,
            "content": content,
        },
        headers=headers,
    )
    item_id = create_resp.json()["data"]["id"]
    process_capture(item_id)

    db = SessionLocal()
    try:
        chunks = (
            db.query(MemoryChunk)
            .filter(MemoryChunk.memory_id == UUID(item_id))
            .order_by(MemoryChunk.chunk_index)
            .all()
        )
        vectors = _hashed_embed([chunk.content for chunk in chunks])
        for chunk, vector in zip(chunks, vectors, strict=False):
            chunk.embedding = vector
        db.commit()
    finally:
        db.close()
    return headers, item_id


def test_search_finds_semantically_related_chunk(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    class Adapter:
        def embed_texts(self, texts: list[str]) -> list[list[float]]:
            return _hashed_embed(texts)

    monkeypatch.setattr("app.services.retrieval_service.get_embedding_adapter", lambda: Adapter())
    headers, _item_id = _index_memory(
        "ask_owner@example.com",
        "Binary Search Explained",
        "https://docs.example.com/binary-search",
        ARTICLE,
    )

    search_resp = client.get(
        "/api/v1/search",
        params={"q": "How does binary search reduce the number of elements?"},
        headers=headers,
    )
    assert search_resp.status_code == 200
    hits = search_resp.json()["data"]
    assert len(hits) >= 1
    assert any("halves the search interval" in hit["content"] for hit in hits)
    assert all(hit["title"] == "Binary Search Explained" for hit in hits)


def test_chat_returns_grounded_answer_and_citations(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    class Adapter:
        def embed_texts(self, texts: list[str]) -> list[list[float]]:
            return _hashed_embed(texts)

    monkeypatch.setattr("app.services.retrieval_service.get_embedding_adapter", lambda: Adapter())
    monkeypatch.setattr(
        "app.services.rag_service.get_settings",
        lambda: type(
            "S",
            (),
            {
                "openai_api_key": "sk-test",
                "openai_chat_model": "gpt-4o-mini",
                "rag_top_k": 8,
                "rag_max_distance": 0.65,
                "rag_max_context_chars": 6000,
            },
        )(),
    )
    monkeypatch.setattr(
        "app.services.rag_service.RagService._complete",
        lambda self, question, chunks: "Binary search halves the remaining interval each step. [Source 1]",
    )
    headers, item_id = _index_memory(
        "ask_rag@example.com",
        "Binary Search Explained",
        "https://docs.example.com/binary-search",
        ARTICLE,
    )

    chat_resp = client.post(
        "/api/v1/chat",
        json={"question": "What did I learn about binary search?"},
        headers=headers,
    )
    assert chat_resp.status_code == 200
    payload = chat_resp.json()["data"]
    assert payload["insufficient_context"] is False
    assert "halves" in payload["answer"].lower()
    assert payload["citations"][0]["memory_id"] == item_id
    assert payload["citations"][0]["url"] == "https://docs.example.com/binary-search"


def test_chat_insufficient_context_does_not_hallucinate(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    class Adapter:
        def embed_texts(self, texts: list[str]) -> list[list[float]]:
            return _hashed_embed(texts)

    monkeypatch.setattr("app.services.retrieval_service.get_embedding_adapter", lambda: Adapter())
    headers, _item_id = _index_memory(
        "ask_empty@example.com",
        "Binary Search Explained",
        "https://docs.example.com/binary-search",
        ARTICLE,
    )
    chat_resp = client.post(
        "/api/v1/chat",
        json={"question": "What did I save about quantum computing superconductors?"},
        headers=headers,
    )
    assert chat_resp.status_code == 200
    payload = chat_resp.json()["data"]
    assert payload["insufficient_context"] is True
    assert "couldn't find enough information" in payload["answer"].lower()
    assert payload["citations"] == []


def test_chat_is_isolated_by_authenticated_user(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    class Adapter:
        def embed_texts(self, texts: list[str]) -> list[list[float]]:
            return _hashed_embed(texts)

    monkeypatch.setattr("app.services.retrieval_service.get_embedding_adapter", lambda: Adapter())
    _owner_headers, item_id = _index_memory(
        "ask_user_a@example.com",
        "Secret Binary Notes",
        "https://example.com/private",
        ARTICLE,
    )
    other_headers = _auth_headers("ask_user_b@example.com")
    search_resp = client.get(
        "/api/v1/search",
        params={"q": "binary search interval"},
        headers=other_headers,
    )
    assert search_resp.status_code == 200
    assert search_resp.json()["data"] == []

    forbidden = client.get(f"/api/v1/memory-items/{item_id}", headers=other_headers)
    assert forbidden.status_code == 404


def test_chat_returns_503_when_llm_not_configured(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """When OPENAI_API_KEY is absent, /chat must return 503 AI_NOT_CONFIGURED.

    It must NOT return 200 with the old 'language model is not configured' fallback text.
    """
    class Adapter:
        def embed_texts(self, texts: list[str]) -> list[list[float]]:
            return _hashed_embed(texts)

    monkeypatch.setattr("app.services.retrieval_service.get_embedding_adapter", lambda: Adapter())
    # Force openai_api_key to None to simulate missing configuration.
    monkeypatch.setattr(
        "app.services.rag_service.get_settings",
        lambda: type(
            "S",
            (),
            {
                "openai_api_key": None,
                "openai_chat_model": "gpt-4o-mini",
                "rag_top_k": 8,
                "rag_max_distance": 0.65,
                "rag_max_context_chars": 6000,
            },
        )(),
    )
    headers, _item_id = _index_memory(
        "ask_nokey@example.com",
        "Binary Search Explained",
        "https://docs.example.com/no-key",
        ARTICLE,
    )
    chat_resp = client.post(
        "/api/v1/chat",
        json={"question": "What is binary search?"},
        headers=headers,
    )
    assert chat_resp.status_code == 503
    body = chat_resp.json()
    assert body["success"] is False
    assert body["error"]["code"] == "AI_NOT_CONFIGURED"
    # Confirm the old fallback string is gone from the response.
    assert "language model is not configured" not in str(body).lower()

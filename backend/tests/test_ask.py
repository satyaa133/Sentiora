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
                "llm_provider": "openai",
                "openai_api_key": "sk-test",
                "gemini_api_key": "gk-test",
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
    assert payload.get("used_fallback") is False
    assert "halves" in payload["answer"].lower()
    assert payload["citations"][0]["memory_id"] == item_id
    assert payload["citations"][0]["url"] == "https://docs.example.com/binary-search"


def test_chat_insufficient_context_does_not_hallucinate(monkeypatch) -> None:  # type: ignore[no-untyped-def]
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
                "llm_provider": "openai",
                "openai_api_key": "sk-test",
                "gemini_api_key": "gk-test",
                "openai_chat_model": "gpt-4o-mini",
                "rag_top_k": 8,
                "rag_max_distance": 0.65,
                "rag_max_context_chars": 6000,
            },
        )(),
    )
    monkeypatch.setattr(
        "app.services.rag_service.RagService._complete",
        lambda self, question, chunks: (
            "I couldn't find enough information in your saved memories to answer that."
        ),
    )
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


def test_chat_uses_grounded_fallback_when_llm_not_configured(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """Missing API key must still return a 200 answer from retrieved memory."""
    monkeypatch.setattr("app.services.retrieval_service.get_embedding_adapter", lambda: None)
    monkeypatch.setattr(
        "app.services.rag_service.get_settings",
        lambda: type(
            "S",
            (),
            {
                "llm_provider": "openai",
                "openai_api_key": None,
                "gemini_api_key": None,
                "openai_chat_model": "gpt-4o-mini",
                "rag_top_k": 8,
                "rag_max_distance": 0.65,
                "rag_max_context_chars": 6000,
            },
        )(),
    )
    headers, item_id = _index_memory(
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
    assert chat_resp.status_code == 200
    payload = chat_resp.json()["data"]
    assert payload["insufficient_context"] is False
    assert payload["used_fallback"] is True
    assert "binary search" in payload["answer"].lower()
    assert "halves" in payload["answer"].lower()
    assert payload["citations"][0]["memory_id"] == item_id
    assert payload["citations"][0]["url"] == "https://docs.example.com/no-key"
    assert "language model is not configured" not in payload["answer"].lower()
    assert "unavailable" not in payload["answer"].lower()


def test_chat_generic_question_answers_from_ready_memory(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr("app.services.retrieval_service.get_embedding_adapter", lambda: None)
    monkeypatch.setattr(
        "app.services.rag_service.get_settings",
        lambda: type(
            "S",
            (),
            {
                "llm_provider": "openai",
                "openai_api_key": None,
                "gemini_api_key": None,
                "openai_chat_model": "gpt-4o-mini",
                "rag_top_k": 8,
                "rag_max_distance": 0.65,
                "rag_max_context_chars": 6000,
            },
        )(),
    )
    headers, item_id = _index_memory(
        "ask_generic@example.com",
        "React Server Components",
        "https://docs.example.com/rsc",
        "React Server Components allow components to render on the server. "
        "This reduces the amount of JavaScript shipped to the browser and can improve load time. "
        "Server-rendered components can fetch data close to the source and stream UI to the client.",
    )
    chat_resp = client.post(
        "/api/v1/chat",
        json={"question": "What is this article about?"},
        headers=headers,
    )
    assert chat_resp.status_code == 200
    payload = chat_resp.json()["data"]
    assert payload["insufficient_context"] is False
    assert payload["used_fallback"] is True
    assert "React Server Components" in payload["answer"]
    assert "render on the server" in payload["answer"]
    assert payload["citations"][0]["memory_id"] == item_id


def test_chat_falls_back_when_llm_completion_fails(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr("app.services.retrieval_service.get_embedding_adapter", lambda: None)
    monkeypatch.setattr(
        "app.services.rag_service.get_settings",
        lambda: type(
            "S",
            (),
            {
                "llm_provider": "openai",
                "openai_api_key": "sk-test",
                "gemini_api_key": None,
                "openai_chat_model": "gpt-4o-mini",
                "rag_top_k": 8,
                "rag_max_distance": 0.65,
                "rag_max_context_chars": 6000,
            },
        )(),
    )

    def _boom(self, question, chunks):  # type: ignore[no-untyped-def]
        raise RuntimeError("provider timeout")

    monkeypatch.setattr("app.services.rag_service.RagService._complete", _boom)
    headers, item_id = _index_memory(
        "ask_llmfail@example.com",
        "Binary Search Explained",
        "https://docs.example.com/llm-fail",
        ARTICLE,
    )
    chat_resp = client.post(
        "/api/v1/chat",
        json={"question": "What is binary search?"},
        headers=headers,
    )
    assert chat_resp.status_code == 200
    payload = chat_resp.json()["data"]
    assert payload["used_fallback"] is True
    assert payload["citations"][0]["memory_id"] == item_id
    assert "halves" in payload["answer"].lower()


def test_search_lexical_without_embeddings(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr("app.services.retrieval_service.get_embedding_adapter", lambda: None)
    headers, item_id = _index_memory(
        "ask_search_lex@example.com",
        "Binary Search Explained",
        "https://docs.example.com/search-lex",
        ARTICLE,
    )
    search_resp = client.get(
        "/api/v1/search",
        params={"q": "halves the search interval"},
        headers=headers,
    )
    assert search_resp.status_code == 200
    hits = search_resp.json()["data"]
    assert len(hits) >= 1
    assert hits[0]["memory_id"] == item_id
    assert any("halves the search interval" in hit["content"] for hit in hits)


REACT_ARTICLE = """
React Server Components allow components to render on the server.
This reduces the amount of JavaScript shipped to the browser and can improve load time.
Server-rendered components can fetch data close to the source and stream UI to the client.
"""

DOCKER_ARTICLE = """
Docker networking connects containers through user-defined bridges and overlay networks.
Containers on the same bridge can reach each other by service name without publishing every port.
Network isolation keeps application traffic off the host's default network unless you map ports.
"""

POSTGRES_ARTICLE = """
PostgreSQL indexing speeds up lookups with B-tree indexes on frequently filtered columns.
Partial and covering indexes can reduce index size when queries always use the same predicates.
Analyze query plans before adding indexes so writes are not slowed without a read benefit.
"""

_FALLBACK_SETTINGS = {
    "llm_provider": "openai",
    "openai_api_key": None,
    "gemini_api_key": None,
    "openai_chat_model": "gpt-4o-mini",
    "rag_top_k": 8,
    "rag_max_distance": 0.65,
    "rag_max_context_chars": 6000,
}


def _index_with_headers(
    headers: dict[str, str],
    title: str,
    url: str,
    content: str,
) -> str:
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
    return item_id


def test_chat_selects_relevant_memory_among_many(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr("app.services.retrieval_service.get_embedding_adapter", lambda: None)
    monkeypatch.setattr(
        "app.services.rag_service.get_settings",
        lambda: type("S", (), _FALLBACK_SETTINGS)(),
    )
    headers = _auth_headers("ask_multi@example.com")
    react_id = _index_with_headers(
        headers,
        "React Server Components",
        "https://docs.example.com/rsc-multi",
        REACT_ARTICLE,
    )
    docker_id = _index_with_headers(
        headers,
        "Docker networking",
        "https://docs.example.com/docker-net",
        DOCKER_ARTICLE,
    )
    postgres_id = _index_with_headers(
        headers,
        "PostgreSQL indexing",
        "https://docs.example.com/pg-index",
        POSTGRES_ARTICLE,
    )

    for query, item_id, needle in (
        ("render on the server", react_id, "render on the server"),
        ("user-defined bridges", docker_id, "user-defined bridges"),
        ("B-tree indexes", postgres_id, "B-tree"),
    ):
        search = client.get("/api/v1/search", params={"q": query}, headers=headers)
        assert search.status_code == 200
        hits = search.json()["data"]
        assert hits
        assert hits[0]["memory_id"] == item_id
        assert any(needle.lower() in hit["content"].lower() for hit in hits)

    react = client.post(
        "/api/v1/chat",
        json={"question": "What is the React article about?"},
        headers=headers,
    ).json()["data"]
    assert react["insufficient_context"] is False
    assert react["citations"][0]["memory_id"] == react_id
    assert "react" in react["answer"].lower()
    assert "docker" not in react["answer"].lower()
    assert "postgresql" not in react["answer"].lower()

    docker = client.post(
        "/api/v1/chat",
        json={"question": "What did I save about Docker networking?"},
        headers=headers,
    ).json()["data"]
    assert docker["citations"][0]["memory_id"] == docker_id
    assert "bridge" in docker["answer"].lower() or "network" in docker["answer"].lower()
    assert "react server" not in docker["answer"].lower()

    postgres = client.post(
        "/api/v1/chat",
        json={"question": "What did I save about PostgreSQL indexing?"},
        headers=headers,
    ).json()["data"]
    assert postgres["citations"][0]["memory_id"] == postgres_id
    assert "index" in postgres["answer"].lower()
    assert "react server" not in postgres["answer"].lower()

    compare = client.post(
        "/api/v1/chat",
        json={"question": "Compare the Docker and PostgreSQL notes."},
        headers=headers,
    ).json()["data"]
    cited = {item["memory_id"] for item in compare["citations"]}
    assert docker_id in cited
    assert postgres_id in cited
    assert react_id not in cited
    assert "docker" in compare["answer"].lower()
    assert "postgresql" in compare["answer"].lower() or "index" in compare["answer"].lower()

    missing = client.post(
        "/api/v1/chat",
        json={"question": "Tell me something about Redis."},
        headers=headers,
    ).json()["data"]
    assert missing["insufficient_context"] is True
    assert missing["citations"] == []


def test_chat_generic_question_uses_latest_when_vault_has_many(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr("app.services.retrieval_service.get_embedding_adapter", lambda: None)
    monkeypatch.setattr(
        "app.services.rag_service.get_settings",
        lambda: type("S", (), _FALLBACK_SETTINGS)(),
    )
    headers = _auth_headers("ask_generic_multi@example.com")
    _index_with_headers(
        headers,
        "React Server Components",
        "https://docs.example.com/rsc-latest",
        REACT_ARTICLE,
    )
    latest_id = _index_with_headers(
        headers,
        "PostgreSQL indexing",
        "https://docs.example.com/pg-latest",
        POSTGRES_ARTICLE,
    )
    generic = client.post(
        "/api/v1/chat",
        json={"question": "What is this article about?"},
        headers=headers,
    ).json()["data"]
    assert generic["insufficient_context"] is False
    assert generic["citations"][0]["memory_id"] == latest_id
    assert "index" in generic["answer"].lower()


def test_chat_hybrid_retrieval_does_not_prefer_unrelated_semantic_hit(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    class Adapter:
        def embed_texts(self, texts: list[str]) -> list[list[float]]:
            return _hashed_embed(texts)

    monkeypatch.setattr("app.services.retrieval_service.get_embedding_adapter", lambda: Adapter())
    monkeypatch.setattr(
        "app.services.rag_service.get_settings",
        lambda: type("S", (), _FALLBACK_SETTINGS)(),
    )
    headers = _auth_headers("ask_hybrid@example.com")
    react_id = _index_with_headers(
        headers,
        "React Server Components",
        "https://docs.example.com/rsc-hybrid",
        REACT_ARTICLE,
    )
    _index_with_headers(
        headers,
        "Docker networking",
        "https://docs.example.com/docker-hybrid",
        DOCKER_ARTICLE,
    )
    chat = client.post(
        "/api/v1/chat",
        json={"question": "What is the React article about?"},
        headers=headers,
    ).json()["data"]
    assert chat["citations"][0]["memory_id"] == react_id
    assert "render on the server" in chat["answer"].lower()

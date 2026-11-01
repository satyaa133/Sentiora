"""OpenRouter embeddings, per-chunk model tracking and the embedding backfill."""

from __future__ import annotations

from types import SimpleNamespace
from uuid import UUID

import httpx
import openai
import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.db import SessionLocal
from app.main import app
from app.models.memory_chunk import MemoryChunk
from app.services import embedding_service
from app.services.embedding_service import (
    OpenRouterEmbeddingAdapter,
    current_embedding_model,
)
from app.services.llm_pool import key_pool
from app.services.retrieval_service import RetrievalService, _Scope
from app.workers.jobs.process_capture import process_capture
from scripts.reprocess_memories import main as reprocess

client = TestClient(app)
DIM = 1536
ARTICLE = (
    "Lighthouse keepers trimmed the wick every four hours through the night. "
    "They logged the weather, polished the lens and kept nine gallons of oil in reserve. "
) * 6


def _status_error(status: int) -> openai.APIStatusError:
    request = httpx.Request("POST", "https://openrouter.ai/api/v1/embeddings")
    return openai.APIStatusError(
        "boom", response=httpx.Response(status, request=request), body=None
    )


class _FakeOpenAI:
    """Stands in for openai.OpenAI; behaviour is chosen per API key."""

    calls: list[tuple[str, int]] = []
    failing: dict[str, int] = {}

    def __init__(self, *, api_key: str, **_: object) -> None:
        self.api_key = api_key
        self.embeddings = SimpleNamespace(create=self._create)

    def _create(self, *, model: str, input: list[str]) -> SimpleNamespace:  # noqa: A002
        _FakeOpenAI.calls.append((self.api_key, len(input)))
        if self.api_key in _FakeOpenAI.failing:
            raise _status_error(_FakeOpenAI.failing[self.api_key])
        data = [
            SimpleNamespace(index=i, embedding=[float(i + 1)] * DIM)
            for i in range(len(input))
        ]
        return SimpleNamespace(data=list(reversed(data)))


@pytest.fixture
def openrouter(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "embedding_provider", "openrouter")
    monkeypatch.setattr(settings, "embedding_model", None)
    monkeypatch.setattr(settings, "openrouter_api_key", "key-a")
    monkeypatch.setattr(settings, "openrouter_api_key_2", "key-b")
    monkeypatch.setattr(embedding_service, "OpenAI", _FakeOpenAI)
    _FakeOpenAI.calls = []
    _FakeOpenAI.failing = {}
    key_pool.reset()


def test_openrouter_adapter_batches_and_orders(openrouter: None) -> None:
    adapter = OpenRouterEmbeddingAdapter()
    assert adapter.model_id == "openrouter:openai/text-embedding-3-small"
    vectors = adapter.embed_texts([f"text {i}" for i in range(70)])
    assert len(vectors) == 70
    assert [size for _, size in _FakeOpenAI.calls] == [64, 6]
    assert vectors[0][0] == 1.0 and vectors[1][0] == 2.0  # sorted by index


def test_openrouter_adapter_fails_over_to_next_key(openrouter: None) -> None:
    _FakeOpenAI.failing = {"key-a": 402}
    adapter = OpenRouterEmbeddingAdapter()
    assert len(adapter.embed_texts(["one"])) == 1
    assert len(adapter.embed_texts(["two"])) == 1
    # key-a cooled down after its 402, so the second call goes straight to key-b.
    assert [key for key, _ in _FakeOpenAI.calls] == ["key-a", "key-b", "key-b"]


def test_openrouter_adapter_raises_when_every_key_fails(openrouter: None) -> None:
    _FakeOpenAI.failing = {"key-a": 401, "key-b": 429}
    with pytest.raises(RuntimeError, match="Every OpenRouter key failed"):
        OpenRouterEmbeddingAdapter().embed_texts(["text"])


def test_embedding_model_override(
    openrouter: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "embedding_model", "qwen/qwen3-embedding-0.6b")
    assert (
        OpenRouterEmbeddingAdapter().model_id == "openrouter:qwen/qwen3-embedding-0.6b"
    )
    assert current_embedding_model() == "openrouter:qwen/qwen3-embedding-0.6b"


class _ModelAdapter:
    def __init__(self, model_id: str, fail: bool = False) -> None:
        self.model_id = model_id
        self.fail = fail

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        if self.fail:
            raise RuntimeError("provider down")
        return [[1.0] + [0.0] * (DIM - 1) for _ in texts]


def _register(email: str) -> tuple[dict[str, str], UUID]:
    password = "MemoryPassword123!"
    client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "full_name": "Embed Tester"},
    )
    token = client.post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    ).json()["data"]["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    user_id = UUID(client.get("/api/v1/users/me", headers=headers).json()["data"]["id"])
    return headers, user_id


def _capture(headers: dict[str, str], slug: str) -> UUID:
    created = client.post(
        "/api/v1/memory-items",
        json={
            "source_type": "webpage",
            "url": f"https://keepers.example.com/{slug}",
            "title": "Lighthouse keepers",
            "content": ARTICLE,
        },
        headers=headers,
    ).json()["data"]
    process_capture(created["id"])
    return UUID(created["id"])


def _chunks(memory_id: UUID) -> list[MemoryChunk]:
    with SessionLocal() as db:
        return db.query(MemoryChunk).filter(MemoryChunk.memory_id == memory_id).all()


def test_capture_records_embedding_model(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.workers.jobs.process_capture.get_embedding_adapter",
        lambda: _ModelAdapter("openrouter:m1"),
    )
    headers, _ = _register("embed_model@example.com")
    memory_id = _capture(headers, "model")
    assert all(c.embedding_model == "openrouter:m1" for c in _chunks(memory_id))


def test_query_only_matches_chunks_from_the_same_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.workers.jobs.process_capture.get_embedding_adapter",
        lambda: _ModelAdapter("openrouter:m1"),
    )
    headers, user_id = _register("embed_match@example.com")
    _capture(headers, "match")

    with SessionLocal() as db:
        service = RetrievalService(db)
        monkeypatch.setattr(
            "app.services.retrieval_service.get_embedding_adapter",
            lambda: _ModelAdapter("openrouter:m1"),
        )
        assert service._semantic_search(
            user_id, "wick", 5, _Scope(None, None, None, None)
        )  # type: ignore[attr-defined]
        monkeypatch.setattr(
            "app.services.retrieval_service.get_embedding_adapter",
            lambda: _ModelAdapter("openrouter:m2"),
        )
        assert (
            service._semantic_search(user_id, "wick", 5, _Scope(None, None, None, None))
            == []
        )  # type: ignore[attr-defined]
        # A failing query embedding never falls back to another provider.
        monkeypatch.setattr(
            "app.services.retrieval_service.get_embedding_adapter",
            lambda: _ModelAdapter("openrouter:m1", fail=True),
        )
        assert (
            service._semantic_search(user_id, "wick", 5, _Scope(None, None, None, None))
            == []
        )  # type: ignore[attr-defined]


def test_backfill_embeds_missing_and_stale_chunks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers, _ = _register("embed_backfill@example.com")
    missing = _capture(headers, "missing")  # no provider at capture time
    monkeypatch.setattr(
        "app.workers.jobs.process_capture.get_embedding_adapter",
        lambda: _ModelAdapter("gemini:old"),
    )
    stale = _capture(headers, "stale")
    assert all(c.embedding is None for c in _chunks(missing))

    monkeypatch.setattr(
        "scripts.reprocess_memories.get_embedding_adapter",
        lambda: _ModelAdapter("openrouter:new"),
    )
    assert (
        reprocess(["--embed", "--user", "embed_backfill@example.com", "--batch", "1"])
        == 0
    )
    for memory_id in (missing, stale):
        chunks = _chunks(memory_id)
        assert chunks and all(
            c.embedding is not None and c.embedding_model == "openrouter:new"
            for c in chunks
        )
    # Idempotent: nothing left to do.
    assert reprocess(["--embed", "--user", "embed_backfill@example.com"]) == 0


def test_backfill_stops_on_provider_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    headers, _ = _register("embed_backfill_fail@example.com")
    memory_id = _capture(headers, "fail")
    monkeypatch.setattr(
        "scripts.reprocess_memories.get_embedding_adapter",
        lambda: _ModelAdapter("openrouter:new", fail=True),
    )
    assert reprocess(["--embed", "--user", "embed_backfill_fail@example.com"]) == 1
    assert all(c.embedding is None for c in _chunks(memory_id))

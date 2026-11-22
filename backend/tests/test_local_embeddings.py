"""S3 local embeddings: LocalEmbeddingAdapter, the embedding_local column,
retrieval reading the active provider's column, and the --embed backfill."""

from __future__ import annotations

import math
from collections.abc import Iterable
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app.core.config import LOCAL_VECTOR_DIMENSIONS, Settings, get_settings
from app.core.db import SessionLocal
from app.main import app
from app.models.memory_chunk import MemoryChunk
from app.services import embedding_service
from app.services.embedding_service import (
    LocalEmbeddingAdapter,
    current_embedding_model,
    get_embedding_adapter,
    resolve_embedding_provider,
)
from app.services.retrieval_service import RetrievalService, _Scope
from app.workers.jobs.process_capture import process_capture
from scripts.reprocess_memories import main as reprocess

client = TestClient(app)
LOCAL_DIM = LOCAL_VECTOR_DIMENSIONS
REMOTE_DIM = 1536
ARTICLE = "\n\n".join(
    f"Part {i}. "
    + (
        "Beekeepers smoke the hive before lifting frames so the bees stay calm. "
        "A strong colony fills ten frames with capped honey by late summer. "
    )
    * 30
    for i in range(4)
)


class _FakeTextEmbedding:
    """Stands in for fastembed.TextEmbedding; records what it was asked to embed."""

    instances = 0
    seen: list[str] = []

    def __init__(self, model_name: str, cache_dir: str | None = None) -> None:
        _FakeTextEmbedding.instances += 1
        self.model_name = model_name

    def embed(self, documents: Iterable[str], batch_size: int = 256) -> Iterable[list[float]]:
        for text in documents:
            _FakeTextEmbedding.seen.append(text)
            yield [1.0] + [0.0] * (LOCAL_DIM - 1)


@pytest.fixture
def local(monkeypatch: pytest.MonkeyPatch) -> None:
    import fastembed

    settings = get_settings()
    monkeypatch.setattr(settings, "embedding_provider", "local")
    monkeypatch.setattr(settings, "local_embedding_model", "nomic-ai/nomic-embed-text-v1.5-Q")
    monkeypatch.setattr(fastembed, "TextEmbedding", _FakeTextEmbedding)
    monkeypatch.setattr(embedding_service, "_local_models", {})
    _FakeTextEmbedding.instances = 0
    _FakeTextEmbedding.seen = []


def test_local_provider_needs_no_key(local: None, monkeypatch: pytest.MonkeyPatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "openrouter_api_key", None)
    monkeypatch.setattr(settings, "openrouter_api_key_2", None)
    monkeypatch.setattr(settings, "openrouter_numbered_keys", {})
    monkeypatch.setattr(settings, "openai_api_key", None)
    monkeypatch.setattr(settings, "gemini_api_key", None)
    assert resolve_embedding_provider() == "local"
    assert current_embedding_model() == "local:nomic-ai/nomic-embed-text-v1.5-Q"
    adapter = get_embedding_adapter()
    assert isinstance(adapter, LocalEmbeddingAdapter)
    assert adapter.model_id == "local:nomic-ai/nomic-embed-text-v1.5-Q"
    assert adapter.dimensions == LOCAL_DIM


def test_model_is_loaded_once_per_process(local: None) -> None:
    LocalEmbeddingAdapter()
    LocalEmbeddingAdapter().embed_query("x")
    assert _FakeTextEmbedding.instances == 1


def test_bge_prefixes_questions_but_not_passages(
    local: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "local_embedding_model", "BAAI/bge-small-en-v1.5")
    monkeypatch.setitem(
        embedding_service.LOCAL_EMBEDDING_DIMENSIONS, "BAAI/bge-small-en-v1.5", LOCAL_DIM
    )
    adapter = LocalEmbeddingAdapter()
    adapter.embed_texts(["Bees make honey."])
    adapter.embed_query("who makes honey?")
    assert _FakeTextEmbedding.seen == [
        "Bees make honey.",
        "Represent this sentence for searching relevant passages: who makes honey?",
    ]


def test_nomic_prefixes_both(local: None) -> None:
    adapter = LocalEmbeddingAdapter()
    adapter.embed_texts(["Bees make honey."])
    adapter.embed_query("who makes honey?")
    assert _FakeTextEmbedding.seen == [
        "search_document: Bees make honey.",
        "search_query: who makes honey?",
    ]


def test_wrong_vector_size_is_rejected(local: None, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        _FakeTextEmbedding, "embed", lambda self, docs, batch_size=0: [[1.0]] * len(list(docs))
    )
    with pytest.raises(RuntimeError, match="dimension"):
        LocalEmbeddingAdapter().embed_texts(["a"])


def test_settings_reject_unknown_or_wrong_size_local_models() -> None:
    with pytest.raises(ValueError, match="LOCAL_EMBEDDING_MODEL"):
        Settings(local_embedding_model="not/a-model")
    # bge-small makes 384-dim vectors; the column is vector(768).
    with pytest.raises(ValueError, match="needs a migration"):
        Settings(local_embedding_model="BAAI/bge-small-en-v1.5")
    assert Settings(local_embedding_model="nomic-ai/nomic-embed-text-v1.5")
    assert Settings(embedding_provider="local").embedding_provider == "local"


def test_relative_model_cache_dir_is_under_backend() -> None:
    settings = Settings(model_cache_dir=".models")
    assert settings.model_cache_path.name == ".models"
    assert settings.model_cache_path.parent.name == "backend"


# --- database: capture, retrieval and backfill use embedding_local --------


class _VectorAdapter:
    """Deterministic adapter for either column: one-hot vectors of its size."""

    def __init__(self, model_id: str, dimensions: int, slot: int = 0) -> None:
        self.model_id = model_id
        self.dimensions = dimensions
        self.slot = slot
        self.calls = 0

    def _vector(self) -> list[float]:
        vector = [0.0] * self.dimensions
        vector[self.slot] = 1.0
        return vector

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        self.calls += len(texts)
        return [self._vector() for _ in texts]

    def embed_query(self, text: str) -> list[float]:
        return self._vector()


LOCAL = _VectorAdapter("local:nomic-ai/nomic-embed-text-v1.5-Q", LOCAL_DIM)
REMOTE = _VectorAdapter("openrouter:m1", REMOTE_DIM)


def _register(email: str) -> tuple[dict[str, str], UUID]:
    password = "MemoryPassword123!"
    client.post(
        "/api/v1/auth/register",
        json={"privacy_consent_version": "2026-11-20", "email": email, "password": password, "full_name": "Local Tester"},
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
            "url": f"https://bees.example.com/{slug}",
            "title": "Keeping bees",
            "content": ARTICLE,
        },
        headers=headers,
    ).json()["data"]
    process_capture(created["id"])
    return UUID(created["id"])


def _chunks(memory_id: UUID) -> list[MemoryChunk]:
    with SessionLocal() as db:
        return db.query(MemoryChunk).filter(MemoryChunk.memory_id == memory_id).all()


def _capture_with(monkeypatch: pytest.MonkeyPatch, adapter: object | None) -> None:
    monkeypatch.setattr(
        "app.workers.jobs.process_capture.get_embedding_adapter", lambda: adapter
    )


def _search(monkeypatch: pytest.MonkeyPatch, adapter: object, user_id: UUID) -> list:
    monkeypatch.setattr(
        "app.services.retrieval_service.get_embedding_adapter", lambda: adapter
    )
    with SessionLocal() as db:
        return RetrievalService(db)._semantic_search(  # type: ignore[attr-defined]
            user_id, "how do beekeepers calm bees", 5, _Scope(None, None, None, None)
        )


def test_local_capture_fills_embedding_local_only(monkeypatch: pytest.MonkeyPatch) -> None:
    _capture_with(monkeypatch, LOCAL)
    headers, _ = _register("local_capture@example.com")
    chunks = _chunks(_capture(headers, "capture"))
    assert chunks
    for chunk in chunks:
        assert chunk.embedding_local is not None and len(chunk.embedding_local) == LOCAL_DIM
        assert chunk.embedding is None and chunk.embedding_model is None


def test_switching_provider_keeps_both_columns(monkeypatch: pytest.MonkeyPatch) -> None:
    """Rollback is a setting: each provider reads only its own column."""
    _capture_with(monkeypatch, REMOTE)
    headers, user_id = _register("local_switch@example.com")
    memory_id = _capture(headers, "switch")

    # Local search finds nothing until the backfill runs...
    assert _search(monkeypatch, LOCAL, user_id) == []
    monkeypatch.setattr("scripts.reprocess_memories.get_embedding_adapter", lambda: LOCAL)
    assert reprocess(["--embed", "--user", "local_switch@example.com"]) == 0

    # ...which leaves the remote vectors and their model id in place.
    for chunk in _chunks(memory_id):
        assert chunk.embedding_local is not None
        assert chunk.embedding is not None and chunk.embedding_model == "openrouter:m1"
    local_hits = _search(monkeypatch, LOCAL, user_id)
    remote_hits = _search(monkeypatch, REMOTE, user_id)
    assert local_hits and remote_hits
    assert all(math.isclose(hit.distance, 0.0, abs_tol=1e-6) for hit in local_hits)
    # MMR vectors come from the column the query was compared with.
    assert all(len(hit.vector) == LOCAL_DIM for hit in local_hits)
    assert all(len(hit.vector) == REMOTE_DIM for hit in remote_hits)


def test_local_search_ignores_chunks_without_a_local_vector(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _capture_with(monkeypatch, None)  # full-text only at capture time
    headers, user_id = _register("local_none@example.com")
    _capture(headers, "none")
    assert _search(monkeypatch, LOCAL, user_id) == []


def test_backfill_is_idempotent_and_force_re_embeds_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _capture_with(monkeypatch, None)
    headers, _ = _register("local_backfill@example.com")
    memory_id = _capture(headers, "backfill")
    count = len(_chunks(memory_id))
    assert count > 1

    adapter = _VectorAdapter("local:nomic-ai/nomic-embed-text-v1.5-Q", LOCAL_DIM)
    monkeypatch.setattr("scripts.reprocess_memories.get_embedding_adapter", lambda: adapter)
    args = ["--embed", "--user", "local_backfill@example.com", "--batch", "1"]
    assert reprocess(args) == 0
    assert adapter.calls == count
    assert reprocess(args) == 0
    assert adapter.calls == count  # nothing left to do

    # --force re-embeds every chunk exactly once (keyset paging, no loop).
    adapter.slot = 1
    assert reprocess([*args, "--force"]) == 0
    assert adapter.calls == 2 * count
    assert all(c.embedding_local[1] == 1.0 for c in _chunks(memory_id))


def test_dedup_copies_local_vectors(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.models.memory_item import ItemStatus, MemoryItem

    _capture_with(monkeypatch, LOCAL)
    headers, _ = _register("local_dedup@example.com")
    first = _capture(headers, "same")
    # A second capture of the same page, still pending: the worker reuses the
    # first one's chunks and vectors instead of embedding again.
    _capture_with(monkeypatch, None)
    second = _capture(headers, "other")
    with SessionLocal() as db:
        item = db.get(MemoryItem, second)
        assert item is not None
        item.url = "https://bees.example.com/same"
        item.status = ItemStatus.pending
        db.commit()
    process_capture(str(second))
    copies = _chunks(second)
    assert len(copies) == len(_chunks(first))
    assert all(c.embedding_local is not None for c in copies)


# --- the real model (runs only when it has been downloaded) ---------------


def _real_model_cached() -> bool:
    cache = get_settings().model_cache_path
    return cache.exists() and any(cache.glob("*nomic-embed-text-v1.5*"))


@pytest.mark.skipif(not _real_model_cached(), reason="local model not downloaded")
def test_real_model_ranks_the_relevant_passage_first(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(get_settings(), "local_embedding_model", "nomic-ai/nomic-embed-text-v1.5-Q")
    adapter = LocalEmbeddingAdapter()
    passages = adapter.embed_texts(
        [
            "Beekeepers use smoke to keep bees calm while opening the hive.",
            "The Federal Reserve raised interest rates by a quarter point.",
        ]
    )
    query = adapter.embed_query("how do you stop bees getting angry")

    def cosine(a: list[float], b: list[float]) -> float:
        dot = sum(x * y for x, y in zip(a, b, strict=True))
        return dot / (math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b)))

    assert len(query) == LOCAL_DIM
    assert cosine(query, passages[0]) > cosine(query, passages[1]) + 0.1

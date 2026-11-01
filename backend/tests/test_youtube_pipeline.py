"""YouTube capture: payload contract → persistence → timestamped chunks → retrieval → Ask."""

import zlib
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app.core.db import SessionLocal
from app.main import app
from app.models.memory_chunk import MemoryChunk
from app.services.chunking import MAX_CHUNK_CHARS, chunk_transcript, format_timestamp
from app.services.content_normalizer import canonicalize_url, youtube_video_id
from app.workers.jobs.process_capture import process_capture
from scripts.reprocess_memories import main as reprocess

client = TestClient(app)

VIDEO_ID = "dQw4w9WgXcQ"
CANONICAL = f"https://www.youtube.com/watch?v={VIDEO_ID}"

# Deterministic transcript fixture: segments as the extension sends them
# (grouped caption cues with start/end seconds), deliberately unpunctuated
# like auto-generated captions.
SEGMENTS = [
    (0.0, 14.2, "welcome back today we are looking at how lighthouse keepers in the eighteen hundreds kept the lamps burning through winter storms"),
    (14.2, 31.0, "the keepers trimmed the wicks every four hours and polished the fresnel lens so the beam could reach twenty nautical miles"),
    (31.0, 52.5, "at the zephyrine point station the keeper logged whale oil consumption which rose to nine gallons a night in january"),
    (52.5, 75.0, "when the oil ran low the keeper switched to lard oil which burned dimmer but kept the light visible to passing schooners"),
    (75.0, 98.4, "the logbooks show the zephyrine point light never went dark during the great gale of eighteen forty seven"),
]


def _nodes() -> list[dict]:
    return [
        {
            "id": f"node-{i}",
            "type": "paragraph",
            "text": text,
            "order": i,
            "parent_id": None,
            "metadata": {"start_seconds": start, "end_seconds": end},
        }
        for i, (start, end, text) in enumerate(SEGMENTS)
    ]


def _payload(url: str = f"https://www.youtube.com/watch?v={VIDEO_ID}&t=42s&list=PL1") -> dict:
    return {
        "source_type": "youtube",
        "url": url,
        "title": "Lighthouse Keepers of the 1800s",
        "author": "Maritime History Channel",
        "thumbnail_url": f"https://img.youtube.com/vi/{VIDEO_ID}/hqdefault.jpg",
        "content": "\n\n".join(text for _, _, text in SEGMENTS),
        "structured_content": _nodes(),
        "extraction": {
            "method": "youtube_transcript",
            "duration_ms": 900,
            "status": "success",
            "quality_score": 0.9,
            "quality_reasons": [],
        },
    }


def _auth_headers(email: str) -> dict[str, str]:
    password = "MemoryPassword123!"
    client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "full_name": "YouTube Tester"},
    )
    login = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    return {"Authorization": f"Bearer {login.json()['data']['access_token']}"}


class _HashedAdapter:
    """Deterministic bag-of-words embeddings (stable across processes)."""
    model_id = "test:hashed"

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        vectors = []
        for text in texts:
            vec = [0.0] * 1536
            for word in text.lower().split():
                vec[zlib.crc32(word.encode()) % 1536] += 1.0
            norm = sum(v * v for v in vec) ** 0.5 or 1.0
            vectors.append([v / norm for v in vec])
        return vectors


class _FailingAdapter:
    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        raise RuntimeError("provider timeout")


def _chunks(item_id: str) -> list[MemoryChunk]:
    db = SessionLocal()
    try:
        return (
            db.query(MemoryChunk)
            .filter(MemoryChunk.memory_id == UUID(item_id))
            .order_by(MemoryChunk.chunk_index)
            .all()
        )
    finally:
        db.close()


@pytest.mark.parametrize(
    "url",
    [
        f"https://www.youtube.com/watch?v={VIDEO_ID}",
        f"https://www.youtube.com/watch?v={VIDEO_ID}&t=42s&list=PL1&utm_source=x",
        f"https://m.youtube.com/watch?feature=share&v={VIDEO_ID}",
        f"https://youtu.be/{VIDEO_ID}?si=abc",
        f"https://www.youtube.com/shorts/{VIDEO_ID}",
        f"https://www.youtube.com/live/{VIDEO_ID}",
        f"https://www.youtube.com/embed/{VIDEO_ID}",
    ],
)
def test_youtube_urls_canonicalize_to_watch_url(url: str) -> None:
    assert youtube_video_id(url) == VIDEO_ID
    assert canonicalize_url(url) == CANONICAL


@pytest.mark.parametrize(
    "url",
    [
        "https://www.youtube.com/",
        "https://www.youtube.com/results?search_query=x",
        "https://www.youtube.com/watch?v=short",
        "https://www.youtube.com/@channel/videos",
        "https://notyoutube.com/watch?v=dQw4w9WgXcQ",
    ],
)
def test_non_video_urls_are_not_treated_as_videos(url: str) -> None:
    assert youtube_video_id(url) is None


def test_format_timestamp() -> None:
    assert format_timestamp(0) == "00:00"
    assert format_timestamp(75.9) == "01:15"
    assert format_timestamp(3725) == "1:02:05"


def test_chunk_transcript_preserves_order_and_time_ranges() -> None:
    # Shuffled input must come back in transcript order.
    nodes = list(reversed(_nodes()))
    drafts = chunk_transcript(nodes, title="Lighthouse Keepers")
    assert drafts, "expected transcript chunks"
    assert [d.chunk_index for d in drafts] == list(range(len(drafts)))
    assert drafts[0].heading is not None and drafts[0].heading.startswith("[00:00–")
    assert drafts[-1].heading is not None and drafts[-1].heading.endswith("01:38]")
    joined = " ".join(d.content for d in drafts)
    assert joined.index("welcome back") < joined.index("great gale")
    assert all(len(d.content) <= MAX_CHUNK_CHARS for d in drafts)


def test_chunk_transcript_splits_long_transcripts_within_limits() -> None:
    long_nodes = [
        {
            "id": f"n{i}",
            "type": "paragraph",
            "text": f"segment {i} " + "keepers polished the lens " * 20,
            "order": i,
            "metadata": {"start_seconds": i * 30.0, "end_seconds": i * 30.0 + 30},
        }
        for i in range(60)
    ]
    drafts = chunk_transcript(long_nodes, title="Long Video")
    assert len(drafts) > 5
    assert all(len(d.content) <= MAX_CHUNK_CHARS for d in drafts)
    starts = [d.heading for d in drafts]
    assert starts == sorted(set(starts), key=starts.index)  # no duplicate ranges


@pytest.mark.parametrize(
    "malformed",
    [None, "not a list", [], [{"text": "no timing"}], [{"metadata": {"start_seconds": 1}}], [42]],
)
def test_chunk_transcript_returns_empty_for_untimed_or_malformed(malformed: object) -> None:
    assert chunk_transcript(malformed, title="x") == []


def test_youtube_capture_persists_transcript_and_timestamped_chunks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.workers.jobs.process_capture.get_embedding_adapter", lambda: _HashedAdapter()
    )
    headers = _auth_headers("yt_persist@example.com")
    created = client.post("/api/v1/memory-items", json=_payload(), headers=headers)
    assert created.status_code == 201
    item = created.json()["data"]
    assert item["url"] == CANONICAL
    assert item["extraction_method"] == "youtube_transcript"
    process_capture(item["id"])

    ready = client.get(f"/api/v1/memory-items/{item['id']}", headers=headers).json()["data"]
    assert ready["status"] == "ready"
    assert "zephyrine point station" in ready["content"]
    assert ready["author"] == "Maritime History Channel"
    assert ready["structured_content"][2]["metadata"]["start_seconds"] == 31.0

    chunks = _chunks(item["id"])
    assert chunks
    assert all(c.source_type.value == "youtube" for c in chunks)
    assert all(c.heading and "[" in c.heading for c in chunks)
    assert all(c.start_sec is not None and c.end_sec is not None for c in chunks)
    assert all(c.embedding is not None and len(c.embedding) == 1536 for c in chunks)
    assert "nine gallons" in " ".join(c.content for c in chunks)


def test_recapturing_same_video_with_different_url_is_deduplicated() -> None:
    headers = _auth_headers("yt_dedup@example.com")
    first = client.post("/api/v1/memory-items", json=_payload(), headers=headers).json()["data"]
    process_capture(first["id"])
    second = client.post(
        "/api/v1/memory-items",
        json=_payload(f"https://youtu.be/{VIDEO_ID}"),
        headers=headers,
    ).json()["data"]
    assert second["id"] == first["id"]
    listed = client.get("/api/v1/memory-items", headers=headers).json()["data"]
    assert sum(1 for i in listed["items"] if i["url"] == CANONICAL) == 1


def test_metadata_only_youtube_capture_is_marked_failed_not_ready() -> None:
    headers = _auth_headers("yt_stub@example.com")
    payload = _payload()
    payload["content"] = "YouTube video titled 'Lighthouse Keepers of the 1800s' by Maritime History Channel."
    payload["structured_content"] = None
    payload["extraction"] = None
    item = client.post("/api/v1/memory-items", json=payload, headers=headers).json()["data"]
    process_capture(item["id"])
    after = client.get(f"/api/v1/memory-items/{item['id']}", headers=headers).json()["data"]
    assert after["status"] == "failed"
    assert after["processing_error"]
    assert _chunks(item["id"]) == []


def test_embedding_failure_keeps_capture_searchable_and_backfill_recovers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers = _auth_headers("yt_embed_fail@example.com")
    monkeypatch.setattr(
        "app.workers.jobs.process_capture.get_embedding_adapter", lambda: _FailingAdapter()
    )
    item = client.post("/api/v1/memory-items", json=_payload(), headers=headers).json()["data"]
    process_capture(item["id"])
    after = client.get(f"/api/v1/memory-items/{item['id']}", headers=headers).json()["data"]
    # The capture is not lost: it is READY and found by full-text search.
    assert after["status"] == "ready"
    chunks = _chunks(item["id"])
    assert chunks and all(c.embedding is None for c in chunks)
    hits = client.get(
        "/api/v1/search", params={"q": "whale oil consumption"}, headers=headers
    ).json()["data"]
    assert hits and hits[0]["memory_id"] == item["id"]

    # The embedding backfill fills the vectors in once the provider works.
    monkeypatch.setattr("scripts.reprocess_memories.get_embedding_adapter", lambda: _HashedAdapter())
    assert reprocess(["--embed", "--user", "yt_embed_fail@example.com"]) == 0
    assert all(c.embedding is not None for c in _chunks(item["id"]))


def test_transcript_phrase_is_retrievable_lexically() -> None:
    headers = _auth_headers("yt_search_lex@example.com")
    item = client.post("/api/v1/memory-items", json=_payload(), headers=headers).json()["data"]
    process_capture(item["id"])
    hits = client.get(
        "/api/v1/search", params={"q": "whale oil consumption"}, headers=headers
    ).json()["data"]
    assert hits and hits[0]["memory_id"] == item["id"]
    assert "whale oil" in hits[0]["content"]
    assert "[" in (hits[0]["heading"] or "")


def test_transcript_is_retrievable_semantically(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.workers.jobs.process_capture.get_embedding_adapter", lambda: _HashedAdapter()
    )
    monkeypatch.setattr(
        "app.services.retrieval_service.get_embedding_adapter", lambda: _HashedAdapter()
    )
    headers = _auth_headers("yt_search_sem@example.com")
    item = client.post("/api/v1/memory-items", json=_payload(), headers=headers).json()["data"]
    process_capture(item["id"])

    # Exercise the pgvector path directly: the public search merges semantic
    # hits with lexical ones and may return the lexical copy of the same chunk.
    from app.core.config import get_settings
    from app.services.retrieval_service import RetrievalService, _Scope

    # Bag-of-words test vectors are far sparser than real embeddings, so a short
    # query sits further away; widen the cutoff for this fixture only.
    monkeypatch.setattr(get_settings(), "rag_min_similarity", 0.05)

    db = SessionLocal()
    try:
        semantic = RetrievalService(db)._semantic_search(
            UUID(item["user_id"]), "lard oil schooners", 5, _Scope()
        )
    finally:
        db.close()
    assert semantic, "expected vector hits"
    assert semantic[0].memory_id == UUID(item["id"])
    assert semantic[0].distance is not None
    assert "lard oil" in semantic[0].content

    hits = client.get(
        "/api/v1/search", params={"q": "lard oil schooners"}, headers=headers
    ).json()["data"]
    assert hits[0]["memory_id"] == item["id"]


def test_grounded_answer_cites_captured_video(monkeypatch: pytest.MonkeyPatch) -> None:
    headers = _auth_headers("yt_ask@example.com")
    item = client.post("/api/v1/memory-items", json=_payload(), headers=headers).json()["data"]
    process_capture(item["id"])
    resp = client.post(
        "/api/v1/chat",
        json={"question": "How much whale oil did the Zephyrine Point keeper use in January?"},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["insufficient_context"] is False
    assert "nine gallons" in data["answer"].lower()
    assert data["citations"][0]["memory_id"] == item["id"]
    assert data["citations"][0]["source_type"] == "youtube"
    assert data["citations"][0]["url"] == CANONICAL


def test_question_outside_transcript_is_not_answered_from_it() -> None:
    headers = _auth_headers("yt_ask_none@example.com")
    item = client.post("/api/v1/memory-items", json=_payload(), headers=headers).json()["data"]
    process_capture(item["id"])
    resp = client.post(
        "/api/v1/chat",
        json={"question": "What is the boiling point of liquid nitrogen in kelvin?"},
        headers=headers,
    )
    data = resp.json()["data"]
    assert data["insufficient_context"] is True
    assert data["citations"] == []

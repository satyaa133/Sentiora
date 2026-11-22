"""S1: a capture whose embedding failed is retried automatically."""

from __future__ import annotations

import threading
import time
from datetime import timedelta
from typing import Any

import fakeredis
import pytest
from fastapi.testclient import TestClient
from rq import Queue

from app.core.db import SessionLocal
from app.main import app
from app.models.memory_chunk import MemoryChunk
from app.models.memory_item import ItemStatus, MemoryItem
from app.workers import worker as worker_module
from app.workers.jobs import process_capture as capture

client = TestClient(app)

ARTICLE = (
    "Binary search halves the search interval at every step. It compares the "
    "target with the middle element and continues on one side of the sorted "
    "collection until the value is found or the range is empty. "
) * 4


class _FailingAdapter:
    model_id = "test:embed"

    def embed_query(self, text: str) -> list[float]:
        return self.embed_texts([text])[0]

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        raise RuntimeError("Connection error.")


class _WorkingAdapter:
    model_id = "test:embed"

    def embed_query(self, text: str) -> list[float]:
        return self.embed_texts([text])[0]

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        return [[0.01] * 1536 for _ in texts]


def _capture(email: str) -> str:
    password = "MemoryPassword123!"
    client.post(
        "/api/v1/auth/register",
        json={"privacy_consent_version": "2026-11-20", "email": email, "password": password, "full_name": "Retry Tester"},
    )
    token = client.post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    ).json()["data"]["access_token"]
    created = client.post(
        "/api/v1/memory-items",
        json={
            "source_type": "webpage",
            "url": f"https://docs.example.com/{email}",
            "title": "Binary Search",
            "content": ARTICLE,
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    return str(created.json()["data"]["id"])


def _chunks(memory_id: str) -> list[MemoryChunk]:
    db = SessionLocal()
    try:
        return (
            db.query(MemoryChunk)
            .filter(MemoryChunk.memory_id == memory_id)
            .order_by(MemoryChunk.chunk_index)
            .all()
        )
    finally:
        db.close()


class _RecordingQueue:
    def __init__(self) -> None:
        self.calls: list[tuple[timedelta, Any, tuple[Any, ...]]] = []

    def enqueue_in(self, delay: timedelta, func: Any, *args: Any) -> None:
        self.calls.append((delay, func, args))


@pytest.fixture
def queue(monkeypatch: pytest.MonkeyPatch) -> _RecordingQueue:
    recording = _RecordingQueue()
    monkeypatch.setattr(capture, "create_queues", lambda: [recording])
    return recording


def test_failed_capture_embedding_schedules_the_first_retry(
    monkeypatch: pytest.MonkeyPatch, queue: _RecordingQueue
) -> None:
    monkeypatch.setattr(capture, "get_embedding_adapter", lambda: _FailingAdapter())
    memory_id = _capture("retry_first@example.com")

    capture.process_capture(memory_id)

    db = SessionLocal()
    try:
        item = db.get(MemoryItem, memory_id)
        assert item is not None and item.status == ItemStatus.ready
    finally:
        db.close()
    assert queue.calls == [
        (timedelta(minutes=1), capture.retry_embedding, (memory_id, 1))
    ]


def test_retry_embeds_the_missing_chunks(
    monkeypatch: pytest.MonkeyPatch, queue: _RecordingQueue
) -> None:
    monkeypatch.setattr(capture, "get_embedding_adapter", lambda: _FailingAdapter())
    memory_id = _capture("retry_works@example.com")
    capture.process_capture(memory_id)
    assert all(chunk.embedding is None for chunk in _chunks(memory_id))

    monkeypatch.setattr(capture, "get_embedding_adapter", lambda: _WorkingAdapter())
    monkeypatch.setattr(capture, "current_embedding_model", lambda: "test:embed")
    capture.retry_embedding(memory_id, 1)

    chunks = _chunks(memory_id)
    assert chunks
    assert all(c.embedding is not None and c.embedding_model == "test:embed" for c in chunks)
    assert len(queue.calls) == 1  # only the retry scheduled by the capture itself


def test_a_failed_retry_schedules_the_next_one_until_attempts_run_out(
    monkeypatch: pytest.MonkeyPatch, queue: _RecordingQueue
) -> None:
    monkeypatch.setattr(capture, "get_embedding_adapter", lambda: _FailingAdapter())
    monkeypatch.setattr(capture, "current_embedding_model", lambda: "test:embed")
    memory_id = _capture("retry_backoff@example.com")
    capture.process_capture(memory_id)

    capture.retry_embedding(memory_id, 1)
    capture.retry_embedding(memory_id, 2)
    capture.retry_embedding(memory_id, 3)

    assert [(delay, args[1]) for delay, _, args in queue.calls] == [
        (timedelta(minutes=1), 1),
        (timedelta(minutes=5), 2),
        (timedelta(minutes=30), 3),
    ]
    assert capture.schedule_embedding_retry(memory_id, 4) is False


def test_worker_queues_scheduled_jobs_once_they_are_due() -> None:
    connection = fakeredis.FakeStrictRedis()
    queue = Queue("sentiora.test-scheduled", connection=connection)
    queue.enqueue_in(timedelta(seconds=-1), print, "due")

    class _Worker:
        queues = [queue]

    worker_stub: Any = _Worker()
    worker_stub.connection = connection
    stop = threading.Event()
    thread = threading.Thread(target=worker_module._move_due_jobs, args=(worker_stub, stop))
    thread.start()
    try:
        deadline = time.monotonic() + 5
        while queue.count == 0 and time.monotonic() < deadline:
            time.sleep(0.05)
    finally:
        stop.set()
        thread.join(timeout=10)
    assert queue.count == 1

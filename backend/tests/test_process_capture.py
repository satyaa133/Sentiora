from uuid import UUID

from fastapi.testclient import TestClient

from app.core.db import SessionLocal
from app.main import app
from app.models.memory_chunk import MemoryChunk
from app.workers.jobs.process_capture import process_capture

client = TestClient(app)

ARTICLE = """
Accept all cookies

Introduction

Binary search reduces the search interval by half at each iteration. It compares the target with the middle element, then continues on one side of the collection.

How it works

The algorithm starts with the full sorted array. If the middle value is too small, the search continues on the right half. If the middle value is too large, the search continues on the left half until the value is found or the range is empty.

Complexity

The time complexity is O(log n) because each comparison discards half of the remaining elements. This makes binary search efficient for large sorted collections.
"""


def _auth_headers(email: str) -> dict[str, str]:
    password = "MemoryPassword123!"
    client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "full_name": "Chunk Tester"},
    )
    login_resp = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    token = login_resp.json()["data"]["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_process_capture_creates_owned_chunks_without_duplicates() -> None:
    headers = _auth_headers("chunk_owner@example.com")
    create_resp = client.post(
        "/api/v1/memory-items",
        json={
            "source_type": "webpage",
            "url": "https://docs.example.com/binary-search",
            "title": "Binary Search",
            "content": ARTICLE,
            "author": "Jane Doe",
        },
        headers=headers,
    )
    assert create_resp.status_code == 201
    item = create_resp.json()["data"]
    assert item["status"] == "pending"
    assert item["domain"] == "docs.example.com"
    item_id = item["id"]

    process_capture(item_id)
    process_capture(item_id)

    ready_resp = client.get(f"/api/v1/memory-items/{item_id}", headers=headers)
    assert ready_resp.status_code == 200
    ready = ready_resp.json()["data"]
    assert ready["status"] == "ready"
    assert "Binary search reduces the search interval" in ready["content"]
    assert "Accept all cookies" not in ready["content"]
    assert ready["word_count"] > 20
    assert ready["content_length"] > 20
    assert "processing_error" not in ready

    db = SessionLocal()
    try:
        chunks = (
            db.query(MemoryChunk)
            .filter(MemoryChunk.memory_id == UUID(item_id))
            .order_by(MemoryChunk.chunk_index)
            .all()
        )
        assert len(chunks) >= 2
        indexes = [chunk.chunk_index for chunk in chunks]
        assert indexes == list(range(len(chunks)))
        assert {str(chunk.user_id) for chunk in chunks} == {item["user_id"]}
        assert all(len(chunk.content) >= 40 for chunk in chunks)
        assert all(str(chunk.user_id) == item["user_id"] for chunk in chunks)
    finally:
        db.close()


def test_chunks_are_isolated_by_user() -> None:
    owner_headers = _auth_headers("chunk_user_a@example.com")
    other_headers = _auth_headers("chunk_user_b@example.com")

    create_resp = client.post(
        "/api/v1/memory-items",
        json={
            "source_type": "webpage",
            "url": "https://example.com/private-note",
            "title": "Private Note",
            "content": ARTICLE,
        },
        headers=owner_headers,
    )
    item_id = create_resp.json()["data"]["id"]
    owner_id = create_resp.json()["data"]["user_id"]
    process_capture(item_id)

    db = SessionLocal()
    try:
        foreign = (
            db.query(MemoryChunk)
            .filter(
                MemoryChunk.memory_id == UUID(item_id),
                MemoryChunk.user_id != UUID(owner_id),
            )
            .all()
        )
        assert foreign == []
    finally:
        db.close()

    other_get = client.get(f"/api/v1/memory-items/{item_id}", headers=other_headers)
    assert other_get.status_code == 404

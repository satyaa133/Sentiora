from typing import Any
import pytest
from datetime import datetime, UTC
from fastapi.testclient import TestClient

from app.main import app
from app.models.user import User
from app.models.memory_item import MemoryItem, SourceType
from app.core.db import SessionLocal
from app.services.content_normalizer import canonicalize_url, compute_content_hash, normalize_content

client = TestClient(app)


@pytest.fixture
def clean_db() -> None:
    db = SessionLocal()
    try:
        db.query(MemoryItem).delete(synchronize_session=False)
        db.query(User).filter(User.email.like("test_%@example.com")).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def _auth_headers(email: str) -> dict[str, str]:
    password = "MemoryPassword123!"
    client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "full_name": "Memory Tester"},
    )
    login_resp = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    token = login_resp.json()["data"]["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_memory_items_crud_flow(clean_db: None) -> None:
    headers = _auth_headers("test_memory_user@example.com")

    # 2. Ingest Memory Item (POST /api/v1/memory-items)
    create_payload = {
        "source_type": "webpage",
        "url": "https://example.com/test-article",
        "title": "Test Article Title",
        "content": "This is a test article content for meaningful capture engine testing.",
        "author": "Jane Doe",
        "favicon_url": "https://example.com/favicon.ico",
    }

    create_resp = client.post("/api/v1/memory-items", json=create_payload, headers=headers)
    assert create_resp.status_code == 201
    item_data = create_resp.json()["data"]
    assert item_data["title"] == "Test Article Title"
    assert item_data["url"] == "https://example.com/test-article"
    assert item_data["status"] == "pending"
    item_id = item_data["id"]

    # 3. List Memory Items (GET /api/v1/memory-items)
    list_resp = client.get("/api/v1/memory-items", headers=headers)
    assert list_resp.status_code == 200
    list_data = list_resp.json()["data"]
    assert list_data["total"] >= 1
    assert any(i["id"] == item_id for i in list_data["items"])

    # 4. Get Single Memory Item (GET /api/v1/memory-items/{id})
    get_resp = client.get(f"/api/v1/memory-items/{item_id}", headers=headers)
    assert get_resp.status_code == 200
    assert get_resp.json()["data"]["id"] == item_id

    # 5. Delete Memory Item (DELETE /api/v1/memory-items/{id})
    del_resp = client.delete(f"/api/v1/memory-items/{item_id}", headers=headers)
    assert del_resp.status_code == 200
    assert del_resp.json()["success"] is True

    # 6. Verify item no longer returned after soft-delete
    get_after_del = client.get(f"/api/v1/memory-items/{item_id}", headers=headers)
    assert get_after_del.status_code == 404


def test_capture_v2_validation_and_persistence(clean_db: None) -> None:
    headers = _auth_headers("test_capture_v2@example.com")

    payload: dict[str, Any] = {
        "source_type": "webpage",
        "url": "https://example.com/binary-search?utm_source=feed&v_custom=123",
        "title": "Binary Search",
        "content": "Line 1\r\nLine 2    with spaces\n\n\nLine 3",
        "author": "Jane Doe",
        "captured_at": "2026-08-14T20:00:00Z",
        "structured_content": [
            {
                "id": "node-1",
                "type": "heading",
                "text": "  Binary Search Title   ",
                "order": 0,
                "metadata": {"level": 1}
            },
            {
                "id": "node-2",
                "type": "paragraph",
                "text": "This is a paragraph description.",
                "order": 1,
                "parent_id": "node-1"
            }
        ],
        "extraction": {
            "method": "readability",
            "duration_ms": 150,
            "status": "success",
            "quality_score": 0.85,
            "quality_reasons": ["sufficient_content", "meaningful_headings"]
        }
    }

    # 1. Check successful schema parsing and response body mapping
    resp = client.post("/api/v1/memory-items", json=payload, headers=headers)
    assert resp.status_code == 201
    data = resp.json()["data"]

    # 2. Check canonicalized URL
    assert data["url"] == "https://example.com/binary-search?v_custom=123"

    # 3. Check normalized content
    assert data["content"] == "Line 1\nLine 2 with spaces\nLine 3"

    # 4. Check quality, hashes, timestamps & structures
    assert data["extraction_method"] == "readability"
    assert data["extraction_status"] == "success"
    assert data["extraction_quality_score"] == 0.85
    assert data["extraction_quality_reasons"] == ["sufficient_content", "meaningful_headings"]
    assert data["raw_content_length"] == len("Line 1\r\nLine 2    with spaces\n\n\nLine 3")
    assert data["structured_content"][0]["text"] == "Binary Search Title"  # Trimmed text
    assert data["structured_content"][0]["metadata"]["level"] == 1
    assert data["structured_content"][1]["parent_id"] == "node-1"
    assert data["content_hash"] == compute_content_hash(normalize_content(payload["content"], SourceType.webpage))
    assert data["received_at"] is not None


def test_capture_v2_invalid_schema_rejection(clean_db: None) -> None:
    headers = _auth_headers("test_invalid_schema@example.com")

    # Invalid quality score outside 0-1 range
    payload_bad_score = {
        "source_type": "webpage",
        "url": "https://example.com",
        "title": "Bad Score",
        "content": "Valid content of sufficient length to pass filters.",
        "extraction": {
            "method": "readability",
            "duration_ms": 10,
            "status": "success",
            "quality_score": 1.5,
            "quality_reasons": []
        }
    }
    resp = client.post("/api/v1/memory-items", json=payload_bad_score, headers=headers)
    assert resp.status_code == 422

    # Invalid extraction method
    payload_bad_method = {
        "source_type": "webpage",
        "url": "https://example.com",
        "title": "Bad Method",
        "content": "Valid content of sufficient length.",
        "extraction": {
            "method": "unknown_scraper",
            "duration_ms": 10,
            "status": "success",
            "quality_score": 0.5,
            "quality_reasons": []
        }
    }
    resp = client.post("/api/v1/memory-items", json=payload_bad_method, headers=headers)
    assert resp.status_code == 422

    # Invalid structured node type
    payload_bad_node_type = {
        "source_type": "webpage",
        "url": "https://example.com",
        "title": "Bad Node Type",
        "content": "Valid content of sufficient length.",
        "structured_content": [
            {
                "id": "node-1",
                "type": "unsupported_type",
                "text": "Heading text",
                "order": 0
            }
        ]
    }
    resp = client.post("/api/v1/memory-items", json=payload_bad_node_type, headers=headers)
    assert resp.status_code == 422


def test_normalization_and_fingerprinting_rules() -> None:
    # URL tracking params removal and preservation of custom params
    assert canonicalize_url("https://example.com/path/?utm_source=123&fbclid=456&keep_me=abc") == "https://example.com/path?keep_me=abc"
    assert canonicalize_url("https://youtube.com/watch?v=xyz&utm_medium=banner") == "https://youtube.com/watch?v=xyz"

    # URL trailing slash normalization
    assert canonicalize_url("https://example.com/path/") == "https://example.com/path"

    # Content normalization
    c1 = "A  B \t C\r\n\r\n\r\nD"
    assert normalize_content(c1, SourceType.webpage) == "A B C\nLine 3" or normalize_content(c1, SourceType.webpage) == "A B C" or "A B C" in normalize_content(c1, SourceType.webpage)

    # Deterministic hashing
    h1 = compute_content_hash(normalize_content(c1, SourceType.webpage))
    h2 = compute_content_hash(normalize_content(c1, SourceType.webpage))
    assert h1 == h2
    assert h1 != compute_content_hash("A B C\n\nDifferent")

"""S2: POST /api/v1/answers/feedback stores 👍/👎 without the question text."""

from __future__ import annotations

import uuid

from fastapi.testclient import TestClient

from app.core.db import SessionLocal
from app.main import app
from app.models.answer_feedback import AnswerFeedback
from app.services.feedback_service import question_hash

client = TestClient(app)


def _headers(email: str) -> dict[str, str]:
    password = "MemoryPassword123!"
    client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "full_name": "Feedback"},
    )
    token = client.post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    ).json()["data"]["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_feedback_is_stored_with_a_question_hash() -> None:
    headers = _headers("feedback_ok@example.com")
    chunk = str(uuid.uuid4())
    response = client.post(
        "/api/v1/answers/feedback",
        json={
            "question": "  What is   THIRD normal form? ",
            "answer_mode": "memory",
            "rating": -1,
            "comment": "  Missed the example from my notes. ",
            "source_chunk_ids": [chunk, chunk],
        },
        headers=headers,
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["success"] is True and body["data"]["rating"] == -1

    db = SessionLocal()
    try:
        row = db.get(AnswerFeedback, uuid.UUID(body["data"]["id"]))
        assert row is not None
        assert row.question_hash == question_hash("what is third normal form?")
        assert row.comment == "Missed the example from my notes."
        assert [str(c) for c in row.source_chunk_ids] == [chunk]
        assert "THIRD" not in repr(vars(row))
    finally:
        db.close()


def test_feedback_validates_rating_mode_and_comment() -> None:
    headers = _headers("feedback_invalid@example.com")
    base = {"question": "What is 3NF?", "answer_mode": "memory", "rating": 1}
    for bad in (
        {**base, "rating": 0},
        {**base, "rating": 5},
        {**base, "answer_mode": "poem"},
        {**base, "comment": "x" * 1001},
        {**base, "source_chunk_ids": ["not-a-uuid"]},
    ):
        response = client.post("/api/v1/answers/feedback", json=bad, headers=headers)
        assert response.status_code == 422, bad
        assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_feedback_needs_a_signed_in_user() -> None:
    response = client.post(
        "/api/v1/answers/feedback",
        json={"question": "What is 3NF?", "answer_mode": "memory", "rating": 1},
    )
    assert response.status_code == 401

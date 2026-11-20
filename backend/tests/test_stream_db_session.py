"""S1: /chat/stream returns its database connection before the answer streams."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.core.db import _get_engine
from app.main import app
from app.services.rag_service import AskEvent, PreparedAnswer, RagService

client = TestClient(app)


def _headers(email: str) -> dict[str, str]:
    password = "MemoryPassword123!"
    client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "full_name": "Pool Tester"},
    )
    token = client.post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    ).json()["data"]["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_stream_holds_no_pooled_connection_while_answering(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers = _headers("pool_release@example.com")
    pool = _get_engine().pool
    seen: list[int] = []

    def prepare(self: RagService, **kwargs: object) -> PreparedAnswer:
        # Touch the database like real retrieval does, so the session opens a
        # transaction and checks a connection out.
        self.retrieval.db.execute(text("SELECT 1"))
        return PreparedAnswer(question=str(kwargs["question"]), history=(), sources=[])

    def run(
        self: RagService, prepared: PreparedAnswer, *, stream: bool = True
    ) -> Iterator[AskEvent]:
        seen.append(pool.checkedout())  # type: ignore[attr-defined]
        yield AskEvent("delta", {"text": "streaming"})
        seen.append(pool.checkedout())  # type: ignore[attr-defined]

    monkeypatch.setattr(RagService, "prepare", prepare)
    monkeypatch.setattr(RagService, "run", run)

    response = client.post(
        "/api/v1/chat/stream", json={"question": "Is the pool free?"}, headers=headers
    )

    assert response.status_code == 200, response.text
    assert seen == [0, 0]

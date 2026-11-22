"""S7: privacy notice consent (D10) and renaming a save."""

from __future__ import annotations

from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.db import SessionLocal
from app.main import app
from app.models.memory_item import MemoryItem
from app.models.user import User
from app.workers.jobs.process_capture import process_capture

client = TestClient(app)
NOTICE = "2026-11-20"
PASSWORD = "MemoryPassword123!"


def _register(email: str, **extra: object) -> object:
    body = {"email": email, "password": PASSWORD, "full_name": "Consent Tester", **extra}
    return client.post("/api/v1/auth/register", json=body)


def _login(email: str) -> dict[str, str]:
    token = client.post(
        "/api/v1/auth/login", json={"email": email, "password": PASSWORD}
    ).json()["data"]["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _user(email: str, *, consent: bool = True) -> tuple[dict[str, str], UUID]:
    assert _register(email, privacy_consent_version=NOTICE).status_code == 201
    headers = _login(email)
    user_id = UUID(client.get("/api/v1/auth/me", headers=headers).json()["data"]["id"])
    if not consent:  # an account from before the notice existed
        with SessionLocal() as db:
            user = db.get(User, user_id)
            assert user is not None
            user.privacy_consent_version = None
            user.privacy_consented_at = None
            db.commit()
    return headers, user_id


def _save(headers: dict[str, str], slug: str) -> str:
    created = client.post(
        "/api/v1/memory-items",
        json={
            "source_type": "webpage",
            "url": f"https://bees.example.com/{slug}",
            "title": "Keeping bees",
            "content": "Beekeepers calm a hive with cool smoke before they open it. "
            "The smoke masks the alarm scent that guard bees release.",
        },
        headers=headers,
    ).json()["data"]
    process_capture(created["id"])
    return str(created["id"])


# -- sign-up -------------------------------------------------------------------


def test_sign_up_requires_the_current_notice() -> None:
    assert _register("consent_none@example.com").status_code == 422
    stale = _register("consent_old@example.com", privacy_consent_version="2025-01-01")
    assert stale.status_code == 422
    assert stale.json()["error"]["code"] == "VALIDATION_ERROR"

    headers, user_id = _user("consent_ok@example.com")
    me = client.get("/api/v1/auth/me", headers=headers).json()["data"]
    assert me["privacy_consent_version"] == NOTICE
    assert me["privacy_consent_current"] is True
    with SessionLocal() as db:
        user = db.get(User, user_id)
        assert user is not None and user.privacy_consented_at is not None


def test_a_new_notice_version_asks_everyone_again(monkeypatch: pytest.MonkeyPatch) -> None:
    headers, _ = _user("consent_bump@example.com")
    monkeypatch.setattr(get_settings(), "privacy_notice_version", "2027-01-01")
    me = client.get("/api/v1/auth/me", headers=headers).json()["data"]
    assert me["privacy_consent_version"] == NOTICE
    assert me["privacy_consent_current"] is False


# -- AI features need consent; instant answers and search don't ---------------


def test_ai_answers_and_summaries_need_consent() -> None:
    headers, _ = _user("consent_ai@example.com", consent=False)
    item_id = _save(headers, "ai")
    question = "Why do beekeepers use cool smoke?"

    for path in ("/api/v1/chat", "/api/v1/chat/stream"):
        blocked = client.post(
            path, json={"question": question, "answer_mode": "ai"}, headers=headers
        )
        assert blocked.status_code == 403
        assert blocked.json()["error"]["code"] == "PRIVACY_CONSENT_REQUIRED"
    enrich = client.post(f"/api/v1/memory-items/{item_id}/enrich", headers=headers)
    assert enrich.status_code == 403
    assert enrich.json()["error"]["code"] == "PRIVACY_CONSENT_REQUIRED"

    # Instant answers, search and opening a save still work...
    assert client.post("/api/v1/chat", json={"question": question}, headers=headers).status_code == 200
    assert client.get("/api/v1/search", params={"q": "smoke"}, headers=headers).status_code == 200
    opened = client.get(f"/api/v1/memory-items/{item_id}", headers=headers)
    assert opened.status_code == 200
    # ...and send nothing to an AI provider: no background enrichment.
    with SessionLocal() as db:
        item = db.get(MemoryItem, UUID(item_id))
        assert item is not None and item.enrichment_status == "none"


def test_accepting_the_notice_unlocks_ai() -> None:
    headers, _ = _user("consent_accept@example.com", consent=False)
    wrong = client.post(
        "/api/v1/users/me/privacy-consent", json={"version": "2025-01-01"}, headers=headers
    )
    assert wrong.status_code == 422
    accepted = client.post(
        "/api/v1/users/me/privacy-consent", json={"version": NOTICE}, headers=headers
    )
    assert accepted.status_code == 200
    assert accepted.json()["data"] == {
        "privacy_consent_version": NOTICE,
        "privacy_consent_current": True,
    }
    item_id = _save(headers, "accept")
    assert client.post(
        f"/api/v1/memory-items/{item_id}/enrich", headers=headers
    ).status_code == 202


# -- renaming a save -------------------------------------------------------------


def test_renaming_a_save() -> None:
    headers, _ = _user("rename_owner@example.com")
    item_id = _save(headers, "rename")
    renamed = client.patch(
        f"/api/v1/memory-items/{item_id}",
        json={"title": "  Calming   a hive  "},
        headers=headers,
    )
    assert renamed.status_code == 200
    assert renamed.json()["data"]["title"] == "Calming a hive"
    listed = client.get(
        "/api/v1/memory-items", params={"q": "Calming"}, headers=headers
    ).json()["data"]["items"]
    assert [item["id"] for item in listed] == [item_id]

    for title in ("   ", "x" * 301):
        bad = client.patch(
            f"/api/v1/memory-items/{item_id}", json={"title": title}, headers=headers
        )
        assert bad.status_code == 422

    other, _ = _user("rename_other@example.com")
    stolen = client.patch(
        f"/api/v1/memory-items/{item_id}", json={"title": "Mine now"}, headers=other
    )
    assert stolen.status_code == 404
    assert stolen.json()["error"]["code"] == "MEMORY_ITEM_NOT_FOUND"

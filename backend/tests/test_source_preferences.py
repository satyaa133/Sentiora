import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.user import User

client = TestClient(app)


@pytest.fixture
def clean_db() -> None:
    from app.core.db import _get_session_factory

    db = _get_session_factory()()
    try:
        db.query(User).filter(User.email.like("test_%@example.com")).delete(
            synchronize_session=False
        )
        db.commit()
    finally:
        db.close()


def _register_and_login(email: str) -> str:
    reg_payload = {
        "email": email,
        "password": "Password123!",
        "full_name": "Test User",
    }
    resp = client.post("/api/v1/auth/register", json=reg_payload)
    assert resp.status_code == 201

    login_resp = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "Password123!"},
    )
    assert login_resp.status_code == 200
    return login_resp.json()["data"]["access_token"]


def test_new_user_has_incomplete_onboarding(clean_db) -> None:
    token = _register_and_login("test_onboarding_new@example.com")
    headers = {"Authorization": f"Bearer {token}"}

    resp = client.get("/api/v1/users/me/source-preferences", headers=headers)
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["onboarding_completed"] is False
    assert data["sources"]["webpages"] == "not_connected"
    assert data["sources"]["notion"] == "not_connected"


def test_complete_onboarding_persists_selected_sources(clean_db) -> None:
    token = _register_and_login("test_onboarding_complete@example.com")
    headers = {"Authorization": f"Bearer {token}"}

    resp = client.post(
        "/api/v1/users/me/onboarding/complete",
        headers=headers,
        json={"selected_sources": ["webpages", "youtube"]},
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["onboarding_completed"] is True
    assert data["sources"]["webpages"] == "active"
    assert data["sources"]["youtube"] == "active"
    assert data["sources"]["github"] == "not_connected"

    me_resp = client.get("/api/v1/users/me", headers=headers)
    assert me_resp.json()["data"]["onboarding_completed"] is True


def test_pause_and_resume_source(clean_db) -> None:
    token = _register_and_login("test_source_pause@example.com")
    headers = {"Authorization": f"Bearer {token}"}

    client.post(
        "/api/v1/users/me/onboarding/complete",
        headers=headers,
        json={"selected_sources": ["youtube"]},
    )

    pause_resp = client.patch(
        "/api/v1/users/me/source-preferences/youtube",
        headers=headers,
        json={"status": "paused"},
    )
    assert pause_resp.status_code == 200
    assert pause_resp.json()["data"]["sources"]["youtube"] == "paused"

    resume_resp = client.patch(
        "/api/v1/users/me/source-preferences/youtube",
        headers=headers,
        json={"status": "active"},
    )
    assert resume_resp.status_code == 200
    assert resume_resp.json()["data"]["sources"]["youtube"] == "active"


def test_connect_optional_source(clean_db) -> None:
    token = _register_and_login("test_source_connect@example.com")
    headers = {"Authorization": f"Bearer {token}"}

    client.post(
        "/api/v1/users/me/onboarding/complete",
        headers=headers,
        json={"selected_sources": ["webpages"]},
    )

    connect_resp = client.patch(
        "/api/v1/users/me/source-preferences/notion",
        headers=headers,
        json={"status": "active"},
    )
    assert connect_resp.status_code == 200
    assert connect_resp.json()["data"]["sources"]["notion"] == "active"

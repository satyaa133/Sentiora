from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import app

client = TestClient(app)


def test_login_rate_limit_returns_429(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    settings = get_settings()
    monkeypatch.setattr(settings, "rate_limit_login_per_minute", 3)
    for _ in range(3):
        client.post("/api/v1/auth/login", json={"email": "rate@example.com", "password": "NoMatch123!"})
    blocked = client.post("/api/v1/auth/login", json={"email": "rate@example.com", "password": "NoMatch123!"})
    assert blocked.status_code == 429
    assert blocked.json()["error"]["code"] == "RATE_LIMITED"
    assert blocked.headers.get("retry-after")


def test_chat_rate_limit_returns_429(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    settings = get_settings()
    monkeypatch.setattr(settings, "rate_limit_chat_per_minute", 2)
    monkeypatch.setattr(settings, "rate_limit_chat_per_user_per_minute", 2)
    password = "MemoryPassword123!"
    email = "chat_limit@example.com"
    client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "full_name": "Chat"},
    )
    token = client.post("/api/v1/auth/login", json={"email": email, "password": password}).json()[
        "data"
    ]["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    client.post("/api/v1/chat", json={"question": "What is binary search?"}, headers=headers)
    client.post("/api/v1/chat", json={"question": "What is binary search?"}, headers=headers)
    blocked = client.post("/api/v1/chat", json={"question": "What is binary search?"}, headers=headers)
    assert blocked.status_code == 429
    assert blocked.json()["error"]["code"] == "RATE_LIMITED"


def test_failed_login_backoff_is_temporary(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    settings = get_settings()
    monkeypatch.setattr(settings, "failed_login_max_attempts", 3)
    monkeypatch.setattr(settings, "failed_login_base_backoff_seconds", 30)
    monkeypatch.setattr(settings, "rate_limit_login_per_minute", 1000)
    email = "backoff_user@example.com"
    client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "Password123!", "full_name": "Backoff"},
    )
    for _ in range(3):
        resp = client.post("/api/v1/auth/login", json={"email": email, "password": "WrongPassword1!"})
        assert resp.status_code == 401
    throttled = client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!"})
    assert throttled.status_code == 429
    assert throttled.json()["error"]["code"] == "AUTH_LOGIN_THROTTLED"


def test_refresh_rate_limit_returns_429(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    settings = get_settings()
    monkeypatch.setattr(settings, "rate_limit_refresh_per_minute", 2)
    for _ in range(2):
        client.post("/api/v1/auth/refresh-token", json={"refresh_token": "not-a-token"})
    blocked = client.post("/api/v1/auth/refresh-token", json={"refresh_token": "not-a-token"})
    assert blocked.status_code == 429
    assert blocked.json()["error"]["code"] == "RATE_LIMITED"


def test_search_rate_limit_returns_429(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    settings = get_settings()
    monkeypatch.setattr(settings, "rate_limit_search_per_user_per_minute", 2)
    email = "search_limit@example.com"
    password = "MemoryPassword123!"
    client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "full_name": "Search"},
    )
    token = client.post("/api/v1/auth/login", json={"email": email, "password": password}).json()[
        "data"
    ]["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    for _ in range(2):
        assert client.get("/api/v1/search?q=binary", headers=headers).status_code == 200
    blocked = client.get("/api/v1/search?q=binary", headers=headers)
    assert blocked.status_code == 429
    assert blocked.json()["error"]["code"] == "RATE_LIMITED"

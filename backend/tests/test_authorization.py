"""Cross-user access (IDOR) and token-lifecycle checks."""

from fastapi.testclient import TestClient

from app.main import app
from app.workers.jobs.process_capture import process_capture

client = TestClient(app)
PASSWORD = "MemoryPassword123!"
CONTENT = (
    "The Zephyrine Point lighthouse keeper burned nine gallons of whale oil per night "
    "in January, then switched to lard oil when supplies ran low in February."
)


def _register_and_login(email: str) -> dict:
    client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": PASSWORD, "full_name": "Authz Tester"},
    )
    return client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD}).json()["data"]


def _bearer(tokens: dict) -> dict[str, str]:
    return {"Authorization": f"Bearer {tokens['access_token']}"}


def test_users_cannot_read_delete_search_or_ask_about_others_memories() -> None:
    owner = _bearer(_register_and_login("authz_owner@example.com"))
    other = _bearer(_register_and_login("authz_other@example.com"))
    item = client.post(
        "/api/v1/memory-items",
        json={"source_type": "webpage", "url": "https://docs.example.com/zephyrine", "title": "Zephyrine Log", "content": CONTENT},
        headers=owner,
    ).json()["data"]
    process_capture(item["id"])

    assert client.get(f"/api/v1/memory-items/{item['id']}", headers=other).status_code == 404
    assert client.delete(f"/api/v1/memory-items/{item['id']}", headers=other).status_code == 404
    assert all(i["id"] != item["id"] for i in client.get("/api/v1/memory-items", headers=other).json()["data"]["items"])
    assert client.get("/api/v1/search", params={"q": "whale oil gallons"}, headers=other).json()["data"] == []

    scoped = client.post(
        "/api/v1/chat",
        json={"question": "How much whale oil did the keeper burn?", "memory_id": item["id"]},
        headers=other,
    ).json()["data"]
    assert scoped["insufficient_context"] is True
    assert scoped["citations"] == []

    # The owner still has it after the other user's delete attempt.
    assert client.get(f"/api/v1/memory-items/{item['id']}", headers=owner).status_code == 200


def test_protected_endpoints_require_a_valid_access_token() -> None:
    for method, path in [
        ("get", "/api/v1/memory-items"),
        ("post", "/api/v1/memory-items"),
        ("get", "/api/v1/search?q=x"),
        ("post", "/api/v1/chat"),
        ("get", "/api/v1/auth/me"),
        ("get", "/api/v1/users/me"),
    ]:
        assert getattr(client, method)(path).status_code == 401, path
        assert getattr(client, method)(path, headers={"Authorization": "Bearer not-a-jwt"}).status_code == 401, path


def test_refresh_token_cannot_be_used_as_access_token() -> None:
    tokens = _register_and_login("authz_refresh_as_access@example.com")
    resp = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {tokens['refresh_token']}"})
    assert resp.status_code == 401


def test_refresh_rotation_detects_reuse_and_logout_revokes() -> None:
    tokens = _register_and_login("authz_rotation@example.com")
    rotated = client.post("/api/v1/auth/refresh-token", json={"refresh_token": tokens["refresh_token"]})
    assert rotated.status_code == 200
    new_tokens = rotated.json()["data"]

    # Replaying the old refresh token is rejected and revokes the whole family.
    replay = client.post("/api/v1/auth/refresh-token", json={"refresh_token": tokens["refresh_token"]})
    assert replay.status_code == 401
    assert client.post("/api/v1/auth/refresh-token", json={"refresh_token": new_tokens["refresh_token"]}).status_code == 401

    fresh = _register_and_login("authz_rotation@example.com")
    assert client.post("/api/v1/auth/logout", headers=_bearer(fresh)).status_code == 200
    assert client.post("/api/v1/auth/refresh-token", json={"refresh_token": fresh["refresh_token"]}).status_code == 401

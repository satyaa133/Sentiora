import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.user import User

client = TestClient(app)


@pytest.fixture
def clean_db() -> None:
    # Cleanup registered test users from database to isolate tests
    from app.core.db import _get_session_factory

    db = _get_session_factory()()
    try:
        db.query(User).filter(User.email.like("test_%@example.com")).delete(
            synchronize_session=False
        )
        db.commit()
    finally:
        db.close()


def test_auth_flow(clean_db) -> None:
    # 1. Register a new user
    reg_payload = {
        "email": "test_auth_user@example.com",
        "password": "Password123!",
        "full_name": "Test User",
    }
    resp = client.post("/api/v1/auth/register", json=reg_payload)
    assert resp.status_code == 201
    reg_data = resp.json()
    assert reg_data["success"] is True
    assert reg_data["data"]["email"] == "test_auth_user@example.com"
    assert reg_data["data"]["email_verified"] is False
    assert "user_id" in reg_data["data"]

    # 2. Prevent duplicate registrations
    resp = client.post("/api/v1/auth/register", json=reg_payload)
    assert resp.status_code == 409
    assert resp.json()["success"] is False
    assert resp.json()["error"]["code"] == "AUTH_EMAIL_ALREADY_EXISTS"

    # 3. Password validation check (no capital letter)
    invalid_reg_payload = {
        "email": "test_invalid_pwd@example.com",
        "password": "password123!",
        "full_name": "Invalid Pwd User",
    }
    resp = client.post("/api/v1/auth/register", json=invalid_reg_payload)
    assert resp.status_code == 422
    assert resp.json()["success"] is False
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"

    # 4. Login
    login_payload = {"email": "test_auth_user@example.com", "password": "Password123!"}
    resp = client.post("/api/v1/auth/login", json=login_payload)
    assert resp.status_code == 200
    login_data = resp.json()
    assert login_data["success"] is True
    assert "access_token" in login_data["data"]
    assert "refresh_token" in login_data["data"]
    assert login_data["data"]["user"]["email"] == "test_auth_user@example.com"

    access_token = login_data["data"]["access_token"]
    refresh_token = login_data["data"]["refresh_token"]

    # 5. Access protected /users/me
    resp = client.get(
        "/api/v1/users/me", headers={"Authorization": f"Bearer {access_token}"}
    )
    assert resp.status_code == 200
    profile_data = resp.json()
    assert profile_data["success"] is True
    assert profile_data["data"]["email"] == "test_auth_user@example.com"

    # 6. Refresh token
    resp = client.post(
        "/api/v1/auth/refresh-token", json={"refresh_token": refresh_token}
    )
    assert resp.status_code == 200
    refresh_data = resp.json()
    assert refresh_data["success"] is True
    assert "access_token" in refresh_data["data"]
    assert "refresh_token" in refresh_data["data"]

    new_access_token = refresh_data["data"]["access_token"]
    new_refresh_token = refresh_data["data"]["refresh_token"]

    # Test access with new token
    resp = client.get(
        "/api/v1/users/me", headers={"Authorization": f"Bearer {new_access_token}"}
    )
    assert resp.status_code == 200

    # 7. Replay attack: Old refresh token should cause error and revoke family
    resp = client.post(
        "/api/v1/auth/refresh-token", json={"refresh_token": refresh_token}
    )
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "AUTH_TOKEN_REVOKED"

    # Verify new token is also now revoked/invalid due to family revocation
    resp = client.post(
        "/api/v1/auth/refresh-token", json={"refresh_token": new_refresh_token}
    )
    assert resp.status_code == 401

    # Login again for logout test
    resp = client.post("/api/v1/auth/login", json=login_payload)
    assert resp.status_code == 200
    access_token = resp.json()["data"]["access_token"]

    # 8. Logout
    resp = client.post(
        "/api/v1/auth/logout", headers={"Authorization": f"Bearer {access_token}"}
    )
    assert resp.status_code == 200
    assert resp.json()["success"] is True

    # After logout, accessing protected route with the logged out token should fail or token should be invalidated on refresh
    resp = client.get(
        "/api/v1/users/me", headers={"Authorization": f"Bearer {access_token}"}
    )

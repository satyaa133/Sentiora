"""Tests for OTP email verification flow."""
from unittest.mock import patch
import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import app

client = TestClient(app)

TEST_EMAIL = "test_otp_user@example.com"
TEST_PASSWORD = "Password123!"
TEST_NAME = "OTP Tester"

REGISTER_PAYLOAD = {
    "email": TEST_EMAIL,
    "password": TEST_PASSWORD,
    "full_name": TEST_NAME,
    "privacy_consent_version": get_settings().privacy_notice_version,
}


@pytest.fixture
def clean_otp_user():
    from app.core.db import _get_session_factory
    from app.models.user import User

    db = _get_session_factory()()
    try:
        db.query(User).filter(User.email == TEST_EMAIL).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


@pytest.fixture(autouse=True)
def enable_verification(monkeypatch):
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "require_email_verification", True)


@pytest.fixture(autouse=True)
def mock_send_email():
    with patch("app.services.auth_service.send_otp_email") as m:
        yield m


@pytest.fixture
def mock_otp_redis():
    """Patch otp_service to use an in-memory dict instead of Redis."""
    _store: dict = {}

    def fake_generate(email: str) -> str:
        otp = "123456"
        _store["otp"] = otp
        _store["attempts"] = 0
        return otp

    def fake_verify(email: str, otp: str):
        if _store.get("attempts", 0) >= 5:
            return False, "OTP_MAX_ATTEMPTS"
        if "otp" not in _store:
            return False, "OTP_EXPIRED"
        if _store["otp"] != otp.strip():
            _store["attempts"] = _store.get("attempts", 0) + 1
            return False, "OTP_INVALID"
        _store.pop("otp", None)
        return True, ""

    def fake_can_resend(email: str) -> bool:
        return not _store.get("resend_blocked")

    def fake_get_ttl(email: str) -> int:
        return 45

    with (
        patch("app.services.otp_service.generate_and_store_otp", side_effect=fake_generate),
        patch("app.services.otp_service.verify_otp", side_effect=fake_verify),
        patch("app.services.otp_service.can_resend", side_effect=fake_can_resend),
        patch("app.services.otp_service.get_resend_ttl", side_effect=fake_get_ttl),
        patch("app.services.auth_service.generate_and_store_otp", side_effect=fake_generate),
        patch("app.services.auth_service.verify_otp", side_effect=fake_verify),
        patch("app.services.auth_service.can_resend", side_effect=fake_can_resend),
        patch("app.services.auth_service.get_resend_ttl", side_effect=fake_get_ttl),
    ):
        yield _store


def test_register_creates_unverified_user(clean_otp_user, mock_otp_redis, mock_send_email):
    r = client.post("/api/v1/auth/register", json=REGISTER_PAYLOAD)
    assert r.status_code == 201
    data = r.json()["data"]
    assert data["email_verified"] is False
    mock_send_email.assert_called_once()


def test_login_blocked_before_verification(clean_otp_user, mock_otp_redis, mock_send_email):
    client.post("/api/v1/auth/register", json=REGISTER_PAYLOAD)
    r = client.post("/api/v1/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "AUTH_EMAIL_NOT_VERIFIED"


def test_verify_email_wrong_otp(clean_otp_user, mock_otp_redis, mock_send_email):
    client.post("/api/v1/auth/register", json=REGISTER_PAYLOAD)
    r = client.post("/api/v1/auth/verify-email", json={"email": TEST_EMAIL, "otp": "000000"})
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "OTP_INVALID"


def test_verify_email_expired_otp(clean_otp_user, mock_otp_redis, mock_send_email):
    client.post("/api/v1/auth/register", json=REGISTER_PAYLOAD)
    mock_otp_redis.pop("otp", None)  # simulate expiry
    r = client.post("/api/v1/auth/verify-email", json={"email": TEST_EMAIL, "otp": "123456"})
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "OTP_EXPIRED"


def test_verify_email_max_attempts(clean_otp_user, mock_otp_redis, mock_send_email):
    client.post("/api/v1/auth/register", json=REGISTER_PAYLOAD)
    mock_otp_redis["attempts"] = 5
    r = client.post("/api/v1/auth/verify-email", json={"email": TEST_EMAIL, "otp": "123456"})
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "OTP_MAX_ATTEMPTS"


def test_verify_email_success_and_login(clean_otp_user, mock_otp_redis, mock_send_email):
    client.post("/api/v1/auth/register", json=REGISTER_PAYLOAD)
    r = client.post("/api/v1/auth/verify-email", json={"email": TEST_EMAIL, "otp": "123456"})
    assert r.status_code == 200
    data = r.json()["data"]
    assert "access_token" in data
    assert "refresh_token" in data

    # Now login succeeds
    login_r = client.post("/api/v1/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert login_r.status_code == 200
    assert "access_token" in login_r.json()["data"]


def test_resend_otp_cooldown(clean_otp_user, mock_otp_redis, mock_send_email):
    client.post("/api/v1/auth/register", json=REGISTER_PAYLOAD)
    mock_otp_redis["resend_blocked"] = True
    r = client.post("/api/v1/auth/resend-otp", json={"email": TEST_EMAIL})
    assert r.status_code == 429
    assert r.json()["error"]["code"] == "OTP_RESEND_COOLDOWN"

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from starlette.requests import Request

from app.core.config import DEFAULT_JWT_SECRET_KEY, Settings, get_settings
from app.core.rate_limit import client_ip
from app.main import app

client = TestClient(app)


def _request(peer: str, forwarded: str | None = None) -> Request:
    headers = [(b"x-forwarded-for", forwarded.encode())] if forwarded else []
    return Request({"type": "http", "headers": headers, "client": (peer, 1234)})


def test_x_forwarded_for_is_ignored_from_untrusted_peers(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "trusted_proxy_ips", [])
    assert client_ip(_request("203.0.113.9", "1.2.3.4")) == "203.0.113.9"


def test_x_forwarded_for_from_trusted_proxy_uses_rightmost_untrusted_hop(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(get_settings(), "trusted_proxy_ips", ["10.0.0.2", "10.0.0.3"])
    # Client-supplied spoof first, then the real client added by the proxy chain.
    assert client_ip(_request("10.0.0.2", "6.6.6.6, 198.51.100.7, 10.0.0.3")) == "198.51.100.7"


def test_spoofed_forwarded_header_cannot_bypass_login_rate_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "trusted_proxy_ips", [])
    monkeypatch.setattr(settings, "rate_limit_login_per_minute", 3)
    statuses = [
        client.post(
            "/api/v1/auth/login",
            json={"email": "nobody_spoof@example.com", "password": "WrongPassword123!"},
            headers={"X-Forwarded-For": f"10.9.8.{i}"},
        ).status_code
        for i in range(5)
    ]
    assert 429 in statuses


def test_security_headers_on_api_responses() -> None:
    resp = client.get("/health")
    assert resp.headers["X-Content-Type-Options"] == "nosniff"
    assert resp.headers["X-Frame-Options"] == "DENY"
    assert resp.headers["Referrer-Policy"] == "no-referrer"
    assert "default-src 'none'" in resp.headers["Content-Security-Policy"]
    assert "Strict-Transport-Security" not in resp.headers  # plain http


def test_docs_are_not_blocked_by_api_csp() -> None:
    resp = client.get("/docs")
    assert resp.status_code == 200
    assert "Content-Security-Policy" not in resp.headers


def test_arbitrary_extension_origins_are_not_granted_cors() -> None:
    resp = client.options(
        "/api/v1/memory-items",
        headers={"Origin": "chrome-extension://someotherextensionid", "Access-Control-Request-Method": "GET"},
    )
    assert resp.headers.get("access-control-allow-origin") is None


def test_configured_frontend_origin_is_granted_cors() -> None:
    origin = get_settings().cors_origins[0]
    resp = client.options(
        "/api/v1/memory-items",
        headers={"Origin": origin, "Access-Control-Request-Method": "GET"},
    )
    assert resp.headers.get("access-control-allow-origin") == origin


def test_oversized_request_body_is_rejected_before_parsing() -> None:
    resp = client.post(
        "/api/v1/auth/login",
        content=b"{}",
        headers={"Content-Type": "application/json", "Content-Length": str(50 * 1024 * 1024)},
    )
    assert resp.status_code == 413
    assert resp.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"


@pytest.mark.parametrize(
    ("secret", "cors"),
    [
        (DEFAULT_JWT_SECRET_KEY, ["https://app.sentiora.example"]),
        ("", ["https://app.sentiora.example"]),
        ("too-short-secret", ["https://app.sentiora.example"]),
        ("x" * 48, ["*"]),
    ],
)
def test_production_settings_reject_weak_configuration(secret: str, cors: list[str]) -> None:
    with pytest.raises(ValidationError):
        Settings(app_environment="production", jwt_secret_key=secret, cors_origins=cors, _env_file=None)


def test_production_settings_accept_strong_configuration() -> None:
    settings = Settings(
        app_environment="production",
        jwt_secret_key="x" * 48,
        cors_origins=["https://app.sentiora.example"],
        _env_file=None,
    )
    assert settings.app_environment == "production"


@pytest.mark.parametrize("url", ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,<b>x</b>", "vbscript:x"])
def test_capture_rejects_script_urls(url: str) -> None:
    client.post(
        "/api/v1/auth/register",
        json={"email": "sec_scheme@example.com", "password": "MemoryPassword123!", "full_name": "Sec"},
    )
    token = client.post(
        "/api/v1/auth/login", json={"email": "sec_scheme@example.com", "password": "MemoryPassword123!"}
    ).json()["data"]["access_token"]
    resp = client.post(
        "/api/v1/memory-items",
        json={"source_type": "webpage", "url": url, "title": "x", "content": "enough words here to be a capture body"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 422

from fastapi.testclient import TestClient

from app.core.sensitive_domains import is_sensitive_url
from app.main import app
from app.models.memory_item import SourceType

client = TestClient(app)


def _auth_headers(email: str) -> dict[str, str]:
    password = "MemoryPassword123!"
    client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "full_name": "Safety Tester"},
    )
    login_resp = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    token = login_resp.json()["data"]["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_is_sensitive_url_allows_local_pdf_and_manual_notes() -> None:
    assert is_sensitive_url("https://www.paypal.com/login", SourceType.webpage) is True
    assert is_sensitive_url("file:///D:/DSA/TCS%20NQT.pdf", SourceType.pdf) is False
    assert is_sensitive_url("file:///D:/notes.html", SourceType.webpage) is True
    assert is_sensitive_url("https://sentiora.app/manual/123", SourceType.webpage) is False
    assert is_sensitive_url("https://docs.example.com/article", SourceType.webpage) is False


def test_create_rejects_sensitive_domain() -> None:
    headers = _auth_headers("safety_block@example.com")
    resp = client.post(
        "/api/v1/memory-items",
        json={
            "source_type": "webpage",
            "url": "https://www.chase.com/account",
            "title": "Bank account",
            "content": "This should never be stored in the vault as a captured login page.",
        },
        headers=headers,
    )
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "CAPTURE_SENSITIVE_BLOCKED"


def test_create_accepts_local_pdf() -> None:
    headers = _auth_headers("safety_pdf@example.com")
    resp = client.post(
        "/api/v1/memory-items",
        json={
            "source_type": "pdf",
            "url": "file:///D:/DSA/TCS%20NQT.pdf",
            "title": "TCS NQT.pdf",
            "content": (
                "TCS NQT is a 3 hour test with foundation and advanced sections. "
                "The foundation paper covers aptitude, reasoning, and verbal ability."
            ),
        },
        headers=headers,
    )
    assert resp.status_code == 201
    assert resp.json()["data"]["source_type"] == "pdf"

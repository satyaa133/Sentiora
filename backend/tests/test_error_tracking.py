"""S2: Sentry is off without a DSN, and never receives personal data."""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

import pytest
import sentry_sdk
from fastapi.testclient import TestClient
from sentry_sdk.envelope import Envelope
from sentry_sdk.transport import Transport

from app.api.deps import get_current_user
from app.core import error_tracking
from app.core.config import get_settings
from app.main import app


class _CapturingTransport(Transport):
    def __init__(self) -> None:
        super().__init__()
        self.events: list[dict[str, Any]] = []

    def capture_envelope(self, envelope: Envelope) -> None:
        for item in envelope.items:
            if item.type == "event" and item.payload.json is not None:
                self.events.append(item.payload.json)


@pytest.fixture
def sentry(monkeypatch: pytest.MonkeyPatch) -> Iterator[_CapturingTransport]:
    monkeypatch.setattr(get_settings(), "sentry_dsn", "https://public@sentry.invalid/1")
    transport = _CapturingTransport()
    assert error_tracking.init_error_tracking("api", transport=transport)
    yield transport
    sentry_sdk.init()  # no DSN: disabled again for the other tests


def test_sentry_stays_off_without_a_dsn(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "sentry_dsn", None)
    assert error_tracking.init_error_tracking("api") is False


def test_server_errors_reach_sentry_without_personal_data(
    sentry: _CapturingTransport,
) -> None:
    def broken_user() -> None:
        raise RuntimeError("database exploded")

    app.dependency_overrides[get_current_user] = broken_user
    try:
        client = TestClient(app, raise_server_exceptions=False)
        response = client.post(
            "/api/v1/chat",
            json={"question": "my secret medical question"},
            headers={"Authorization": "Bearer secret-token-value"},
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    sentry_sdk.flush()

    assert response.status_code == 500
    assert sentry.events, "the error was not reported"
    event = sentry.events[0]
    assert event["tags"]["component"] == "api"
    dumped = json.dumps(sentry.events)
    assert "database exploded" in dumped
    assert "my secret medical question" not in dumped  # no request body
    assert "secret-token-value" not in dumped  # no auth header
    for exception in event.get("exception", {}).get("values", []):
        for frame in exception.get("stacktrace", {}).get("frames", []):
            assert "vars" not in frame  # no local variables

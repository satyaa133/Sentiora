import pytest

from app.core.config import get_settings
from app.core.login_backoff import login_backoff
from app.core.rate_limit import limiter


@pytest.fixture(autouse=True)
def disable_rq_enqueue(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep capture tests in-process so a live Windows worker cannot race them."""

    def _unavailable() -> None:
        raise RuntimeError("rq disabled in tests")

    monkeypatch.setattr("app.services.memory_service.create_queues", _unavailable)


@pytest.fixture(autouse=True)
def disable_live_embeddings(monkeypatch: pytest.MonkeyPatch) -> None:
    """Do not call the real embedding provider during pytest (keys in local .env)."""
    monkeypatch.setattr(
        "app.workers.jobs.process_capture.get_embedding_adapter",
        lambda: None,
    )


@pytest.fixture(autouse=True)
def reset_security_limiters(monkeypatch: pytest.MonkeyPatch) -> None:
    limiter.reset()
    login_backoff.reset()
    settings = get_settings()
    monkeypatch.setattr(settings, "rate_limit_login_per_minute", 1000)
    monkeypatch.setattr(settings, "rate_limit_register_per_minute", 1000)
    monkeypatch.setattr(settings, "rate_limit_chat_per_minute", 1000)
    monkeypatch.setattr(settings, "rate_limit_chat_per_user_per_minute", 1000)
    monkeypatch.setattr(settings, "failed_login_max_attempts", 1000)

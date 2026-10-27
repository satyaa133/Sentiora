import os
import pytest

from tests.testdb import (
    UnsafeTestDatabaseError,
    assert_safe_test_database,
    development_database_url,
    ensure_test_database,
    redact,
    resolve_test_database_url,
    truncate_all_tables,
)

# Ensure the app environment is set to development for tests before any app modules are imported
os.environ.setdefault("APP_ENVIRONMENT", "development")

# Point the whole app at the dedicated test database before app.core.config is
# imported. Process env vars take precedence over .env files in pydantic-settings.
_dev_url = development_database_url()
if _dev_url:
    os.environ["SENTIORA_DEV_DATABASE_URL"] = _dev_url
try:
    TEST_DATABASE_URL, _derived = resolve_test_database_url()
    assert_safe_test_database(TEST_DATABASE_URL)
except UnsafeTestDatabaseError as exc:
    pytest.exit(f"Unsafe test database configuration: {exc}", returncode=2)
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
# Never call live embedding providers from tests (index or query time), even if
# real keys exist in the local .env files.
os.environ["EMBEDDING_PROVIDER"] = "none"
for _key in ("OPENAI_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY"):
    os.environ[_key] = ""

from app.core.config import get_settings  # noqa: E402
from app.core.login_backoff import login_backoff  # noqa: E402
from app.core.rate_limit import limiter  # noqa: E402


def pytest_report_header() -> str:
    source = "derived from DATABASE_URL" if _derived else "TEST_DATABASE_URL"
    return f"test database ({source}): {redact(TEST_DATABASE_URL)}"


@pytest.fixture(scope="session", autouse=True)
def isolated_test_database() -> None:
    """Create/migrate the dedicated test DB and start every session from empty."""
    settings = get_settings()
    if settings.database_url != TEST_DATABASE_URL:
        pytest.exit("App settings are not pointed at the test database.", returncode=2)
    ensure_test_database(TEST_DATABASE_URL)
    truncate_all_tables(TEST_DATABASE_URL)


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
    monkeypatch.setattr(settings, "rate_limit_refresh_per_minute", 1000)
    monkeypatch.setattr(settings, "rate_limit_search_per_user_per_minute", 1000)
    monkeypatch.setattr(settings, "failed_login_max_attempts", 1000)

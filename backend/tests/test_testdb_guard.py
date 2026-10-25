import pytest

from tests.testdb import (
    UnsafeTestDatabaseError,
    assert_safe_test_database,
    resolve_test_database_url,
    truncate_all_tables,
)

DEV = "postgresql+psycopg://postgres:pw@localhost:5433/Sentiora"


@pytest.fixture
def dev_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SENTIORA_DEV_DATABASE_URL", DEV)
    monkeypatch.delenv("TEST_DATABASE_URL", raising=False)
    monkeypatch.delenv("PYTEST_XDIST_WORKER", raising=False)
    monkeypatch.setenv("APP_ENVIRONMENT", "development")


def test_refuses_development_database(dev_env: None) -> None:
    with pytest.raises(UnsafeTestDatabaseError):
        assert_safe_test_database(DEV)


def test_refuses_database_without_test_in_name(dev_env: None) -> None:
    with pytest.raises(UnsafeTestDatabaseError):
        assert_safe_test_database("postgresql+psycopg://u:p@db:5432/sentiora_prod")


def test_refuses_production_environment(
    dev_env: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("APP_ENVIRONMENT", "production")
    with pytest.raises(UnsafeTestDatabaseError):
        assert_safe_test_database("postgresql+psycopg://u:p@db:5432/sentiora_test")


def test_truncate_refuses_unsafe_target(dev_env: None) -> None:
    # The guard runs before any connection is attempted.
    with pytest.raises(UnsafeTestDatabaseError):
        truncate_all_tables(DEV)


def test_derives_dedicated_database_when_unset(dev_env: None) -> None:
    url, derived = resolve_test_database_url()
    assert derived is True
    assert url.endswith("/sentiora_test")
    assert_safe_test_database(url)


def test_explicit_test_database_url_wins(
    dev_env: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("TEST_DATABASE_URL", "postgresql+psycopg://u:p@h:1/my_test_db")
    url, derived = resolve_test_database_url()
    assert derived is False
    assert url.endswith("/my_test_db")


def test_parallel_workers_get_separate_databases(
    dev_env: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("PYTEST_XDIST_WORKER", "gw1")
    url, _ = resolve_test_database_url()
    assert url.endswith("/sentiora_test_gw1")

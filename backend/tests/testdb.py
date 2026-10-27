"""Dedicated test database resolution, safety guard, and provisioning.

Tests must never run against the development or production database. The test
database URL comes from ``TEST_DATABASE_URL``; when it is unset, it is derived
from the configured ``DATABASE_URL`` by swapping the database name for
``sentiora_test`` (same server, separate database). Every destructive operation
goes through :func:`assert_safe_test_database` first.

CLI (used by the Playwright stack):
    python -m tests.testdb prepare   # create + migrate, print redacted target
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL, make_url

BACKEND_DIR = Path(__file__).resolve().parents[1]
DEFAULT_TEST_DATABASE_NAME = "sentiora_test"


class UnsafeTestDatabaseError(RuntimeError):
    pass


def _dotenv_value(key: str) -> str | None:
    """Read a key from repo-root .env then backend/.env (backend wins), like Settings."""
    value: str | None = None
    for env_file in (BACKEND_DIR.parent / ".env", BACKEND_DIR / ".env"):
        if not env_file.is_file():
            continue
        for raw in env_file.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            name, _, val = line.partition("=")
            if name.strip() == key:
                value = val.strip().strip('"').strip("'")
    return value


def development_database_url() -> str | None:
    """The non-test DATABASE_URL (process env first, then .env files)."""
    return os.environ.get("SENTIORA_DEV_DATABASE_URL") or os.environ.get(
        "DATABASE_URL"
    ) or _dotenv_value("DATABASE_URL")


def resolve_test_database_url() -> tuple[str, bool]:
    """Return (url, derived). ``derived`` is True when TEST_DATABASE_URL was unset."""
    explicit = os.environ.get("TEST_DATABASE_URL") or _dotenv_value("TEST_DATABASE_URL")
    if explicit:
        url = make_url(explicit)
        derived = False
    else:
        dev = development_database_url()
        if not dev:
            raise UnsafeTestDatabaseError(
                "Set TEST_DATABASE_URL (or DATABASE_URL so a sentiora_test database "
                "can be derived on the same server)."
            )
        url = make_url(dev).set(database=DEFAULT_TEST_DATABASE_NAME)
        derived = True

    # Give each pytest-xdist worker its own database so parallel runs never collide.
    worker = os.environ.get("PYTEST_XDIST_WORKER")
    if worker and url.database:
        url = url.set(database=f"{url.database}_{worker}")
    return url.render_as_string(hide_password=False), derived


def redact(url: str) -> str:
    return make_url(url).render_as_string(hide_password=True)


def assert_safe_test_database(url: str) -> None:
    """Refuse any target that is not clearly a dedicated test database."""
    target = make_url(url)
    name = (target.database or "").lower()
    if "test" not in name:
        raise UnsafeTestDatabaseError(
            f"Refusing to use database '{target.database}' for tests: the name must "
            "contain 'test'."
        )
    dev = development_database_url()
    if dev:
        dev_url = make_url(dev)
        same_server = (dev_url.host, dev_url.port) == (target.host, target.port)
        if same_server and (dev_url.database or "").lower() == name:
            raise UnsafeTestDatabaseError(
                "Refusing to run tests: the test database is the development database."
            )
    if os.environ.get("APP_ENVIRONMENT", "development") == "production":
        raise UnsafeTestDatabaseError("Refusing to run tests with APP_ENVIRONMENT=production.")


def _maintenance_url(target: URL) -> URL:
    return target.set(database="postgres")


def ensure_test_database(url: str) -> None:
    """Create the test database if missing, enable pgvector, and migrate to head."""
    assert_safe_test_database(url)
    target = make_url(url)

    admin = create_engine(_maintenance_url(target), isolation_level="AUTOCOMMIT")
    try:
        with admin.connect() as conn:
            exists = conn.execute(
                text("SELECT 1 FROM pg_database WHERE datname = :name"),
                {"name": target.database},
            ).scalar()
            if not exists:
                conn.execute(text(f'CREATE DATABASE "{target.database}"'))
    finally:
        admin.dispose()

    engine = create_engine(target)
    try:
        with engine.begin() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    finally:
        engine.dispose()

    # Run the alembic console script in a subprocess so migrations run with a
    # fresh interpreter and the target DATABASE_URL, isolated from this process.
    scripts_dir = Path(sys.executable).parent
    alembic_bin = shutil.which("alembic", path=str(scripts_dir)) or shutil.which("alembic")
    if not alembic_bin:
        raise RuntimeError("alembic executable not found; install backend[dev] dependencies.")
    env = {**os.environ, "DATABASE_URL": url}
    result = subprocess.run(
        [alembic_bin, "upgrade", "head"],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Test database migration failed:\n{result.stderr[-2000:]}")


def truncate_all_tables(url: str) -> None:
    """Empty every application table. Only ever runs against a verified test DB."""
    assert_safe_test_database(url)
    engine = create_engine(url)
    try:
        with engine.begin() as conn:
            tables = conn.execute(
                text(
                    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' "
                    "AND tablename <> 'alembic_version'"
                )
            ).scalars().all()
            if tables:
                joined = ", ".join(f'"{t}"' for t in tables)
                conn.execute(text(f"TRUNCATE {joined} RESTART IDENTITY CASCADE"))
    finally:
        engine.dispose()


def main(argv: list[str]) -> int:
    if argv[:1] != ["prepare"]:
        print("usage: python -m tests.testdb prepare", file=sys.stderr)
        return 2
    url, derived = resolve_test_database_url()
    ensure_test_database(url)
    truncate_all_tables(url)
    source = "derived from DATABASE_URL" if derived else "TEST_DATABASE_URL"
    print(f"Test database ready ({source}): {redact(url)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

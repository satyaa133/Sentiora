"""Isolated backend stack for Playwright: API + RQ worker on the test database.

Never touches the development database or the development worker's queue:
  * DATABASE_URL  -> the verified test database (see tests/testdb.py), reset on start
  * REDIS_URL     -> same Redis server, separate logical DB (E2E_REDIS_DB, default 15)
  * API port      -> E2E_API_PORT (default 8100)
Providers are disabled so answers are deterministic (grounded local fallback).
If Redis is unreachable (e.g. CI), no worker is started and the API processes
captures inline, which is its documented fallback.

Usage (from backend/):  python -m tests.e2e_stack
"""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from urllib.parse import urlsplit, urlunsplit

from tests.testdb import (
    _dotenv_value,
    assert_safe_test_database,
    ensure_test_database,
    redact,
    resolve_test_database_url,
    truncate_all_tables,
)


def _e2e_redis_url() -> str:
    base = os.environ.get("REDIS_URL") or _dotenv_value("REDIS_URL") or "redis://127.0.0.1:6379/0"
    parts = urlsplit(base)
    db = os.environ.get("E2E_REDIS_DB", "15")
    return urlunsplit((parts.scheme, parts.netloc, f"/{db}", parts.query, parts.fragment))


def _redis_reachable(url: str) -> bool:
    try:
        from redis import Redis

        return bool(Redis.from_url(url, socket_connect_timeout=1).ping())
    except Exception:
        return False


def main() -> int:
    # Remember the development database so the safety guard can compare against it.
    dev = os.environ.get("DATABASE_URL") or _dotenv_value("DATABASE_URL")
    if dev:
        os.environ.setdefault("SENTIORA_DEV_DATABASE_URL", dev)

    db_url, _ = resolve_test_database_url()
    assert_safe_test_database(db_url)
    ensure_test_database(db_url)
    truncate_all_tables(db_url)

    redis_url = _e2e_redis_url()
    port = os.environ.get("E2E_API_PORT", "8100")
    frontend_origin = os.environ.get("E2E_FRONTEND_ORIGIN", "http://localhost:5180")
    env = {
        **os.environ,
        "DATABASE_URL": db_url,
        "REDIS_URL": redis_url,
        "APP_ENVIRONMENT": "development",
        "CORS_ORIGINS": f'["{frontend_origin}"]',
        "EMBEDDING_PROVIDER": "none",
        "OPENAI_API_KEY": "",
        "GEMINI_API_KEY": "",
        "OPENROUTER_API_KEY": "",
        "OPENROUTER_API_KEY_2": "",
        "RATE_LIMIT_REGISTER_PER_MINUTE": "1000",
        "RATE_LIMIT_LOGIN_PER_MINUTE": "1000",
        "RATE_LIMIT_CHAT_PER_MINUTE": "1000",
        "RATE_LIMIT_CHAT_PER_USER_PER_MINUTE": "1000",
    }

    with_worker = _redis_reachable(redis_url)
    if with_worker:
        # Drop stale jobs from earlier runs; this logical DB is reserved for e2e.
        from redis import Redis

        Redis.from_url(redis_url).flushdb()

    print(
        f"[e2e] database={redact(db_url)} redis_db={urlsplit(redis_url).path} "
        f"api=:{port} worker={'on' if with_worker else 'off (inline processing)'}",
        flush=True,
    )

    procs = [
        subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", port],
            env=env,
        )
    ]
    if with_worker:
        procs.append(subprocess.Popen([sys.executable, "-m", "app.workers.worker"], env=env))

    def shutdown(*_: object) -> None:
        for proc in procs:
            if proc.poll() is None:
                proc.terminate()
        for proc in procs:
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
        sys.exit(0)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    if hasattr(signal, "SIGBREAK"):
        signal.signal(signal.SIGBREAK, shutdown)

    try:
        while all(proc.poll() is None for proc in procs):
            time.sleep(0.5)
    finally:
        shutdown()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

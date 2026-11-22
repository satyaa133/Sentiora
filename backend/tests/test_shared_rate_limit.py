"""S1: rate limits are shared through Redis, with an in-process fallback."""

from __future__ import annotations

from typing import cast

import fakeredis
import pytest
from fastapi.testclient import TestClient
from redis.exceptions import ConnectionError as RedisConnectionError

from app.core.config import get_settings
from app.core.rate_limit import SharedRateLimiter
from app.core.redis_client import SharedRedis, shared_redis
from app.main import app

client = TestClient(app)


def _shared(server: fakeredis.FakeServer) -> SharedRedis:
    redis = SharedRedis()
    redis.use(fakeredis.FakeRedis(server=server))
    return redis


def test_limit_counts_in_redis_and_reports_retry_after() -> None:
    limiter = SharedRateLimiter(_shared(fakeredis.FakeServer()))
    results = [limiter.allow("login:ip:1.2.3.4", 3, 60) for _ in range(4)]
    assert [allowed for allowed, _ in results] == [True, True, True, False]
    assert 1 <= results[-1][1] <= 60


def test_two_processes_share_one_limit() -> None:
    server = fakeredis.FakeServer()
    first = SharedRateLimiter(_shared(server))
    second = SharedRateLimiter(_shared(server))
    assert first.allow("chat:user:u1", 2, 60) == (True, 0)
    assert second.allow("chat:user:u1", 2, 60) == (True, 0)
    # A third request is refused whichever process receives it.
    assert first.allow("chat:user:u1", 2, 60)[0] is False
    assert second.allow("chat:user:u1", 2, 60)[0] is False
    # Other keys are unaffected.
    assert second.allow("chat:user:u2", 2, 60) == (True, 0)


def test_refused_requests_do_not_count() -> None:
    server = fakeredis.FakeServer()
    limiter = SharedRateLimiter(_shared(server))
    limiter.allow("k", 1, 60)
    for _ in range(5):
        assert limiter.allow("k", 1, 60)[0] is False
    redis = fakeredis.FakeRedis(server=server)
    # Only the allowed request is in the window, so a client hammering the
    # endpoint can't keep itself locked out.
    assert redis.zcard("sentiora:ratelimit:k") == 1
    assert 0 < cast(int, redis.pttl("sentiora:ratelimit:k")) <= 60_000


def test_redis_outage_falls_back_and_stops_retrying() -> None:
    connects = 0

    class _DownRedis:
        def pipeline(self, transaction: bool = True) -> None:
            raise RedisConnectionError("refused")

    def factory() -> _DownRedis:
        nonlocal connects
        connects += 1
        return _DownRedis()

    redis = SharedRedis(factory=factory)  # type: ignore[arg-type]
    limiter = SharedRateLimiter(redis)

    assert limiter.allow("k", 2, 60) == (True, 0)
    assert limiter.allow("k", 2, 60) == (True, 0)
    assert limiter.allow("k", 2, 60)[0] is False  # the in-memory fallback counts
    assert connects == 1  # Redis isn't retried during the back-off period


def test_login_limit_over_http_uses_redis(monkeypatch: pytest.MonkeyPatch) -> None:
    server = fakeredis.FakeServer()
    shared_redis.use(fakeredis.FakeRedis(server=server))
    monkeypatch.setattr(get_settings(), "rate_limit_login_per_minute", 2)
    body = {"email": "shared_rate@example.com", "password": "NoMatch123!"}
    statuses = [client.post("/api/v1/auth/login", json=body).status_code for _ in range(3)]
    assert statuses[-1] == 429
    keys = cast(
        list[bytes], fakeredis.FakeRedis(server=server).keys("sentiora:ratelimit:login:*")
    )
    assert len(keys) == 1

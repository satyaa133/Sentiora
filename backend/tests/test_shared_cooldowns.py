"""S1: a failing AI key is skipped by every process (cooldowns shared in Redis)."""

from __future__ import annotations

from typing import cast

import fakeredis
import pytest

from app.core.redis_client import SharedRedis
from app.services.llm_pool import KeyPool, LLMBackend

FAILING = LLMBackend(name="openrouter", provider="openrouter", api_key="sk-or-secret-1", model="m")
HEALTHY = LLMBackend(name="gemini", provider="gemini", api_key="gm-secret-2", model="m")


def _pool(server: fakeredis.FakeServer) -> KeyPool:
    redis = SharedRedis()
    redis.use(fakeredis.FakeRedis(server=server))
    return KeyPool(redis)


@pytest.fixture
def server() -> fakeredis.FakeServer:
    return fakeredis.FakeServer()


def test_a_key_cooled_in_one_process_is_skipped_in_another(
    server: fakeredis.FakeServer,
) -> None:
    api, worker = _pool(server), _pool(server)
    assert api.mark_failed(FAILING, 402, timed_out=False, cooldown_seconds=300)

    # The worker never saw the failure but still puts the key last.
    assert worker.order([FAILING, HEALTHY], rotate=False) == [HEALTHY, FAILING]
    assert 299 < worker.cooldown_remaining(FAILING) <= 300
    assert worker.cooldown_remaining(HEALTHY) == 0


def test_failure_count_is_shared_so_backoff_keeps_doubling(
    server: fakeredis.FakeServer,
) -> None:
    first, second = _pool(server), _pool(server)
    first.mark_failed(FAILING, None, timed_out=True, cooldown_seconds=300)  # 30 s
    first.mark_failed(FAILING, None, timed_out=True, cooldown_seconds=300)  # 60 s
    second.mark_failed(FAILING, None, timed_out=True, cooldown_seconds=300)  # 3rd: 120 s
    assert 119 < second.cooldown_remaining(FAILING) <= 120


def test_success_anywhere_clears_the_shared_cooldown(
    server: fakeredis.FakeServer,
) -> None:
    first, second = _pool(server), _pool(server)
    first.mark_failed(FAILING, 429, timed_out=False, cooldown_seconds=300)
    second.mark_ok(FAILING)
    assert fakeredis.FakeRedis(server=server).keys("sentiora:llm:*") == []
    # The first process still has its own local cooldown until it succeeds.
    third = _pool(server)
    assert third.cooldown_remaining(FAILING) == 0


def test_redis_never_stores_the_api_key(server: fakeredis.FakeServer) -> None:
    _pool(server).mark_failed(FAILING, 401, timed_out=False, cooldown_seconds=300)
    redis = fakeredis.FakeRedis(server=server)
    keys = cast(list[bytes], redis.keys("*"))
    assert keys
    stored = b" ".join(keys) + b" ".join(
        cast(bytes, redis.get(key)) for key in keys if redis.type(key) == b"string"
    )
    assert b"sk-or-secret-1" not in stored


def test_without_redis_each_process_keeps_its_own_state() -> None:
    off = SharedRedis()
    off.use(None)
    first, second = KeyPool(off), KeyPool(off)
    first.mark_failed(FAILING, 402, timed_out=False, cooldown_seconds=300)
    assert first.cooldown_remaining(FAILING) > 0
    assert second.cooldown_remaining(FAILING) == 0

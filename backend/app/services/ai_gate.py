"""AI gate: at most ``LLM_MAX_CONCURRENT`` AI answers at once, across processes.

Every "Explain with AI" answer takes a slot before calling a provider and gives
it back when its stream ends. When every slot is taken the request fails fast
with ``AI_BUSY`` and a retry time instead of queueing behind slow providers.

Slots live in a Redis sorted set (member = slot id, score = start time), so all
API processes share one limit. A slot left behind by a crashed process expires
after ``SLOT_TTL_SECONDS``. Without Redis each process enforces the limit on
its own (in-process counter), as rate limits do.
"""

from __future__ import annotations

import contextlib
import math
import threading
import time
import uuid
from dataclasses import dataclass
from typing import cast

from redis import Redis

from app.core.config import get_settings
from app.core.redis_client import KEY_PREFIX, RedisUnavailableError, SharedRedis, shared_redis

_SLOTS_KEY = f"{KEY_PREFIX}ai:slots"
# Longest an answer may hold a slot (first-token budget plus streaming).
SLOT_TTL_SECONDS = 90.0
# When busy, the client is told to retry after about this long at most.
_MAX_RETRY_AFTER_SECONDS = 30


class AIBusyError(RuntimeError):
    """Every AI slot is taken; retry after ``retry_after`` seconds."""

    def __init__(self, retry_after: int) -> None:
        super().__init__(f"AI is busy; retry after {retry_after} s")
        self.retry_after = retry_after


@dataclass
class AISlot:
    """A held slot; ``release`` is safe to call more than once."""

    gate: AIGate
    member: str
    shared: bool
    released: bool = False

    def release(self) -> None:
        if self.released:
            return
        self.released = True
        self.gate.release(self)


def _retry_after(oldest_started: float | None, now: float) -> int:
    """Seconds until the oldest answer should be done (its first-token budget)."""
    budget = float(get_settings().llm_chat_timeout_seconds)
    if oldest_started is None:
        return max(1, math.ceil(budget))
    left = oldest_started + budget - now
    return min(_MAX_RETRY_AFTER_SECONDS, max(1, math.ceil(left)))


class AIGate:
    def __init__(self, redis: SharedRedis = shared_redis) -> None:
        self._redis = redis
        self._lock = threading.Lock()
        self._local: dict[str, float] = {}

    def _limit(self) -> int:
        return int(get_settings().llm_max_concurrent)

    def acquire(self) -> AISlot:
        """Take a slot or raise ``AIBusyError``."""
        member = uuid.uuid4().hex
        limit = self._limit()
        try:
            self._redis.run(lambda client: self._acquire_shared(client, member, limit))
            return AISlot(self, member, shared=True)
        except RedisUnavailableError:
            pass
        now = time.time()
        with self._lock:
            for key, started in list(self._local.items()):
                if started < now - SLOT_TTL_SECONDS:
                    del self._local[key]
            if len(self._local) >= limit:
                oldest = min(self._local.values()) if self._local else None
                raise AIBusyError(_retry_after(oldest, now))
            self._local[member] = now
        return AISlot(self, member, shared=False)

    @staticmethod
    def _acquire_shared(client: Redis, member: str, limit: int) -> None:
        now = time.time()
        pipe = client.pipeline(transaction=True)
        pipe.zremrangebyscore(_SLOTS_KEY, 0, now - SLOT_TTL_SECONDS)
        pipe.zadd(_SLOTS_KEY, {member: now})
        pipe.zcard(_SLOTS_KEY)
        pipe.expire(_SLOTS_KEY, int(SLOT_TTL_SECONDS) * 2)
        _, _, count, _ = pipe.execute()
        if int(count) <= limit:
            return
        # Over the limit: this request takes nothing.
        client.zrem(_SLOTS_KEY, member)
        oldest = cast(
            list[tuple[bytes, float]], client.zrange(_SLOTS_KEY, 0, 0, withscores=True)
        )
        raise AIBusyError(_retry_after(float(oldest[0][1]) if oldest else None, now))

    def release(self, slot: AISlot) -> None:
        if slot.shared:
            # Without Redis the slot expires after SLOT_TTL_SECONDS.
            with contextlib.suppress(RedisUnavailableError):
                self._redis.run(lambda client: client.zrem(_SLOTS_KEY, slot.member))
            return
        with self._lock:
            self._local.pop(slot.member, None)

    def in_use(self) -> int:
        """Slots held now (tests and metrics)."""
        try:
            # Sync client: the stubs type replies as "Awaitable | Any".
            count = cast(
                int,
                self._redis.run(
                    lambda client: client.zcount(
                        _SLOTS_KEY, time.time() - SLOT_TTL_SECONDS, "+inf"
                    )
                ),
            )
            return int(count)
        except RedisUnavailableError:
            with self._lock:
                return len(self._local)

    def reset(self) -> None:
        with self._lock:
            self._local.clear()
        with contextlib.suppress(RedisUnavailableError):
            self._redis.run(lambda client: client.delete(_SLOTS_KEY))


ai_gate = AIGate()

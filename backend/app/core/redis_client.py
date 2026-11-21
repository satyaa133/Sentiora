"""Shared Redis access for state every API process and worker must agree on.

Rate limits and AI key cooldowns live here so all processes see the same
counts. Redis is optional at request time: when it can't be reached, callers
fall back to their in-process state. After a failure Redis is skipped for
``RETRY_AFTER_FAILURE_SECONDS`` so an outage doesn't add a connection timeout
to every request.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable
from typing import TypeVar

from redis import Redis
from redis.exceptions import RedisError

from app.core.config import get_settings

logger = logging.getLogger(__name__)

# Rate-limit and cooldown checks sit on the request path: fail fast.
SOCKET_TIMEOUT_SECONDS = 0.5
RETRY_AFTER_FAILURE_SECONDS = 30.0
KEY_PREFIX = "sentiora:"

T = TypeVar("T")


class RedisUnavailableError(RuntimeError):
    """Redis can't be used right now; use the in-process fallback."""


def _connect() -> Redis:
    return Redis.from_url(
        get_settings().redis_url,
        socket_connect_timeout=SOCKET_TIMEOUT_SECONDS,
        socket_timeout=SOCKET_TIMEOUT_SECONDS,
    )


class SharedRedis:
    def __init__(self, factory: Callable[[], Redis] = _connect) -> None:
        self._factory = factory
        self._client: Redis | None = None
        self._down_until = 0.0
        self._enabled = True
        self._lock = threading.Lock()

    def run(self, operation: Callable[[Redis], T]) -> T:
        """Run ``operation`` on Redis, or raise ``RedisUnavailableError``."""
        if not self._enabled or time.monotonic() < self._down_until:
            raise RedisUnavailableError("Redis is unavailable")
        with self._lock:
            if self._client is None:
                self._client = self._factory()
            client = self._client
        try:
            return operation(client)
        except (RedisError, OSError) as exc:
            with self._lock:
                self._down_until = time.monotonic() + RETRY_AFTER_FAILURE_SECONDS
            logger.warning(
                "Redis unavailable (%s); using in-process state for %.0f s",
                type(exc).__name__,
                RETRY_AFTER_FAILURE_SECONDS,
            )
            raise RedisUnavailableError(str(exc)) from exc

    def use(self, client: Redis | None) -> None:
        """Use ``client`` from now on, or turn Redis off with ``None`` (tests)."""
        with self._lock:
            self._client = client
            self._enabled = client is not None
            self._down_until = 0.0

    def reset(self) -> None:
        """Back to connecting from settings on first use."""
        with self._lock:
            self._client = None
            self._enabled = True
            self._down_until = 0.0


shared_redis = SharedRedis()

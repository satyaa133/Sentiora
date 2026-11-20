"""Rate limiting for FastAPI routes, shared across processes through Redis.

Limits are configured in Settings so they are not hardcoded at call sites.
Counts live in Redis so N API processes allow the limit once, not N times;
when Redis is down, each process falls back to its own in-memory window.
"""

from __future__ import annotations

import threading
import time
import uuid
from collections import defaultdict, deque
from typing import cast

from fastapi import HTTPException, Request, status
from redis import Redis

from app.core.config import Settings, get_settings
from app.core.redis_client import KEY_PREFIX, RedisUnavailableError, SharedRedis, shared_redis


class SlidingWindowLimiter:
    """In-process sliding window: the fallback when Redis is unavailable."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str, limit: int, window_seconds: int) -> tuple[bool, int]:
        now = time.monotonic()
        cutoff = now - window_seconds
        with self._lock:
            bucket = self._hits[key]
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()
            if len(bucket) >= limit:
                retry_after = max(1, int(window_seconds - (now - bucket[0])))
                return False, retry_after
            bucket.append(now)
            return True, 0

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


def _redis_allow(
    client: Redis, key: str, limit: int, window_seconds: int
) -> tuple[bool, int]:
    """Sliding window in a sorted set: one member per allowed request."""
    redis_key = f"{KEY_PREFIX}ratelimit:{key}"
    now_ms = int(time.time() * 1000)
    window_ms = window_seconds * 1000
    member = f"{now_ms}:{uuid.uuid4().hex}"
    pipe = client.pipeline(transaction=True)
    pipe.zremrangebyscore(redis_key, 0, now_ms - window_ms)
    pipe.zadd(redis_key, {member: now_ms})
    pipe.zcard(redis_key)
    pipe.pexpire(redis_key, window_ms)
    _, _, count, _ = pipe.execute()
    if int(count) <= limit:
        return True, 0
    # Over the limit: this request doesn't count. Retry when the oldest expires.
    client.zrem(redis_key, member)
    # Sync client: the stubs type replies as "Awaitable | Any".
    oldest = cast(
        list[tuple[bytes, float]], client.zrange(redis_key, 0, 0, withscores=True)
    )
    oldest_ms = float(oldest[0][1]) if oldest else float(now_ms)
    retry_after = max(1, int((oldest_ms + window_ms - now_ms) / 1000))
    return False, retry_after


class SharedRateLimiter:
    def __init__(self, redis: SharedRedis) -> None:
        self._redis = redis
        self._fallback = SlidingWindowLimiter()

    def allow(self, key: str, limit: int, window_seconds: int) -> tuple[bool, int]:
        try:
            return self._redis.run(
                lambda client: _redis_allow(client, key, limit, window_seconds)
            )
        except RedisUnavailableError:
            return self._fallback.allow(key, limit, window_seconds)

    def reset(self) -> None:
        self._fallback.reset()


limiter = SharedRateLimiter(shared_redis)


def client_ip(request: Request, settings: Settings | None = None) -> str:
    """Client address for rate limiting.

    X-Forwarded-For is honoured only when the direct peer is a configured
    trusted proxy; otherwise any client could spoof a fresh IP per request and
    bypass login/register limits. With trusted proxies, the right-most address
    that is not itself a trusted proxy is the real client.
    """
    cfg = settings or get_settings()
    peer = request.client.host if request.client else None
    if peer == "testclient":
        peer = "127.0.0.1"
    trusted = set(cfg.trusted_proxy_ips)
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded and peer in trusted:
        hops = [hop.strip() for hop in forwarded.split(",") if hop.strip()]
        for hop in reversed(hops):
            if hop not in trusted:
                return hop
    return peer or "unknown"


def enforce_rate_limit(key: str, limit: int, window_seconds: int) -> None:
    allowed, retry_after = limiter.allow(key, limit, window_seconds)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "code": "RATE_LIMITED",
                "message": "Too many requests. Please wait and try again.",
            },
            headers={"Retry-After": str(retry_after)},
        )


def limit_login(request: Request, settings: Settings | None = None) -> None:
    cfg = settings or get_settings()
    enforce_rate_limit(
        f"login:ip:{client_ip(request)}",
        cfg.rate_limit_login_per_minute,
        60,
    )


def limit_register(request: Request, settings: Settings | None = None) -> None:
    cfg = settings or get_settings()
    enforce_rate_limit(
        f"register:ip:{client_ip(request)}",
        cfg.rate_limit_register_per_minute,
        60,
    )


def limit_chat(request: Request, user_id: str, settings: Settings | None = None) -> None:
    cfg = settings or get_settings()
    ip = client_ip(request)
    enforce_rate_limit(f"chat:ip:{ip}", cfg.rate_limit_chat_per_minute, 60)
    enforce_rate_limit(
        f"chat:user:{user_id}",
        cfg.rate_limit_chat_per_user_per_minute,
        60,
    )


def limit_refresh(request: Request, settings: Settings | None = None) -> None:
    cfg = settings or get_settings()
    enforce_rate_limit(
        f"refresh:ip:{client_ip(request)}",
        cfg.rate_limit_refresh_per_minute,
        60,
    )


def limit_search(request: Request, user_id: str, settings: Settings | None = None) -> None:
    # Each search embeds the query, which is a paid provider call.
    cfg = settings or get_settings()
    enforce_rate_limit(
        f"search:user:{user_id}",
        cfg.rate_limit_search_per_user_per_minute,
        60,
    )

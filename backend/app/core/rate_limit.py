"""In-memory rate limiting for FastAPI routes.

Limits are configured in Settings so they are not hardcoded at call sites.
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status

from app.core.config import Settings, get_settings


class SlidingWindowLimiter:
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


limiter = SlidingWindowLimiter()


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client and request.client.host:
        if request.client.host == "testclient":
            return "127.0.0.1"
        return request.client.host
    return "unknown"


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

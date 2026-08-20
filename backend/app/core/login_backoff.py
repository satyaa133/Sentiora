"""Temporary failed-login throttling. Does not permanently lock accounts."""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass

from fastapi import HTTPException, status

from app.core.config import get_settings


@dataclass
class _AttemptState:
    failures: int = 0
    blocked_until: float = 0.0


class LoginBackoff:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._state: dict[str, _AttemptState] = {}

    def _key(self, email: str, ip_address: str | None) -> str:
        return f"{(ip_address or 'unknown').lower()}|{(email or '').lower()}"

    def precheck(self, email: str, ip_address: str | None) -> None:
        key = self._key(email, ip_address)
        now = time.monotonic()
        with self._lock:
            state = self._state.get(key)
            if state and state.blocked_until > now:
                wait = max(1, int(state.blocked_until - now))
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail={
                        "code": "AUTH_LOGIN_THROTTLED",
                        "message": (
                            "Too many failed sign-in attempts. "
                            f"Try again in {wait} seconds."
                        ),
                    },
                    headers={"Retry-After": str(wait)},
                )

    def record_failure(self, email: str, ip_address: str | None) -> None:
        settings = get_settings()
        key = self._key(email, ip_address)
        now = time.monotonic()
        with self._lock:
            state = self._state.setdefault(key, _AttemptState())
            state.failures += 1
            if state.failures >= settings.failed_login_max_attempts:
                multiplier = 2 ** (state.failures - settings.failed_login_max_attempts)
                backoff = min(
                    settings.failed_login_max_backoff_seconds,
                    settings.failed_login_base_backoff_seconds * multiplier,
                )
                state.blocked_until = now + backoff

    def record_success(self, email: str, ip_address: str | None) -> None:
        key = self._key(email, ip_address)
        with self._lock:
            self._state.pop(key, None)

    def reset(self) -> None:
        with self._lock:
            self._state.clear()


login_backoff = LoginBackoff()

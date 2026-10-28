"""Chat-model keys Ask can use, rotated round-robin with failover.

Every configured chat key becomes a backend: the LLM_PROVIDER keys first
(for OpenRouter: OPENROUTER_API_KEY, then OPENROUTER_API_KEY_1..N), then any
other provider whose key is set. Calls rotate the starting backend to spread
load; a backend that fails with an exhausted, revoked or rate-limited key (or
an overload/timeout) cools down with exponential backoff and is skipped, so an
answer never waits on a dead key. At most LLM_MAX_ATTEMPTS backends are tried
per call. Keys are never logged.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Any

from app.core.config import openrouter_keys

# Statuses that mean "this key will keep failing for a while".
COOLDOWN_STATUSES = frozenset({401, 402, 403, 429})
DEFAULT_COOLDOWN_SECONDS = 300
DEFAULT_MAX_COOLDOWN_SECONDS = 3600
DEFAULT_MAX_ATTEMPTS = 4
# Overloads (5xx) and timeouts are usually over within seconds.
TRANSIENT_COOLDOWN_SECONDS = 30


@dataclass(frozen=True)
class LLMBackend:
    name: str
    provider: str  # "openai" | "openrouter" | "gemini"
    api_key: str
    model: str


def _setting(settings: Any, name: str, default: Any = None) -> Any:
    value = getattr(settings, name, default)
    return default if value is None else value


def max_attempts(settings: Any) -> int:
    return max(1, int(_setting(settings, "llm_max_attempts", DEFAULT_MAX_ATTEMPTS)))


def build_backends(settings: Any) -> list[LLMBackend]:
    """Ordered, de-duplicated list of every chat backend with a key."""
    openrouter_model = _setting(
        settings, "openrouter_chat_model", "anthropic/claude-haiku-4.5"
    )
    candidates = {
        "openrouter": [
            (
                "openrouter" if index == 1 else f"openrouter-{index}",
                key,
                openrouter_model,
            )
            for index, key in enumerate(openrouter_keys(settings), start=1)
        ],
        "gemini": [
            (
                "gemini",
                _setting(settings, "gemini_api_key"),
                _setting(settings, "gemini_chat_model", "gemini-2.5-flash"),
            ),
        ],
        "openai": [
            (
                "openai",
                _setting(settings, "openai_api_key"),
                _setting(settings, "openai_chat_model", "gpt-4o-mini"),
            ),
        ],
    }
    primary = (_setting(settings, "llm_provider") or "openai").strip().lower()
    order = [primary] + [p for p in ("openrouter", "gemini", "openai") if p != primary]

    backends: list[LLMBackend] = []
    seen_keys: set[str] = set()
    for provider in order:
        for name, key, model in candidates.get(provider, []):
            if not key or key in seen_keys:
                continue
            seen_keys.add(key)
            backends.append(
                LLMBackend(name=name, provider=provider, api_key=key, model=model)
            )
    return backends


class KeyPool:
    """Process-wide rotation and cooldown state, shared by every request."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        # One round-robin turn per backend list, so embedding calls rotating
        # their keys do not shift which chat backend answers first.
        self._turns: dict[tuple[str, ...], int] = {}
        self._cooling_until: dict[str, float] = {}
        self._failures: dict[str, int] = {}

    def order(
        self, backends: list[LLMBackend], *, rotate: bool = True
    ) -> list[LLMBackend]:
        """Backends to try, healthy ones first in rotated order.

        Cooling backends go last (soonest to recover first) rather than being
        dropped, so a request still has a chance when every key is cooling.
        ``rotate=False`` keeps the current turn, for secondary calls (such as
        answer metadata) that must not skew the round-robin between answers.
        """
        if not backends:
            return []
        now = time.monotonic()
        with self._lock:
            group = tuple(b.name for b in backends)
            turn = self._turns.get(group, 0)
            start = turn % len(backends)
            if rotate:
                self._turns[group] = turn + 1
            rotated = backends[start:] + backends[:start]
            healthy = [
                b for b in rotated if self._cooling_until.get(b.api_key, 0.0) <= now
            ]
            cooling = sorted(
                (b for b in rotated if self._cooling_until.get(b.api_key, 0.0) > now),
                key=lambda b: self._cooling_until[b.api_key],
            )
        return healthy + cooling

    def mark_failed(
        self,
        backend: LLMBackend,
        status: int | None,
        *,
        timed_out: bool,
        cooldown_seconds: int,
        max_cooldown_seconds: int = DEFAULT_MAX_COOLDOWN_SECONDS,
        retry_after: float | None = None,
    ) -> bool:
        """Cool a backend down when its failure is likely to repeat. Returns True if cooled.

        Credit, auth and rate-limit failures start at ``cooldown_seconds``; an
        overload or timeout starts at 30 s. Each consecutive failure of the same
        key doubles the wait, capped at ``max_cooldown_seconds``. A provider's
        ``Retry-After`` is used when it asks for longer.
        """
        if status is not None and status in COOLDOWN_STATUSES:
            base = cooldown_seconds
        elif timed_out or (status is not None and status >= 500):
            base = min(TRANSIENT_COOLDOWN_SECONDS, cooldown_seconds)
        else:
            return False
        with self._lock:
            failures = self._failures.get(backend.api_key, 0) + 1
            self._failures[backend.api_key] = failures
            seconds = min(base * 2 ** (failures - 1), max(max_cooldown_seconds, base))
            if retry_after is not None and retry_after > seconds:
                seconds = min(retry_after, max(max_cooldown_seconds, base))
            self._cooling_until[backend.api_key] = time.monotonic() + seconds
        return True

    def cooldown_remaining(self, backend: LLMBackend) -> float:
        with self._lock:
            return max(
                0.0, self._cooling_until.get(backend.api_key, 0.0) - time.monotonic()
            )

    def mark_ok(self, backend: LLMBackend) -> None:
        with self._lock:
            self._cooling_until.pop(backend.api_key, None)
            self._failures.pop(backend.api_key, None)

    def reset(self) -> None:
        with self._lock:
            self._turns.clear()
            self._cooling_until.clear()
            self._failures.clear()


def retry_after_seconds(exc: BaseException) -> float | None:
    """``Retry-After`` (seconds) from an SDK error's HTTP response, if any."""
    response = getattr(exc, "response", None)
    headers = getattr(response, "headers", None)
    if headers is None:
        return None
    try:
        value = headers.get("retry-after")
    except Exception:
        return None
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


key_pool = KeyPool()

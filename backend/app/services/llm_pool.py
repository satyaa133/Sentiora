"""Chat-model keys Ask can use, rotated round-robin with failover.

Every configured chat key becomes a backend: the LLM_PROVIDER key first, then
OPENROUTER_API_KEY_2, then any other provider whose key is set. Calls rotate the
starting backend to spread load; a backend that fails with an exhausted,
revoked or rate-limited key (or times out) cools down and is skipped, so an
answer never waits on a dead key. Keys are never logged.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Any

# Statuses that mean "this key will keep failing for a while".
COOLDOWN_STATUSES = frozenset({401, 402, 403, 429})
DEFAULT_COOLDOWN_SECONDS = 300
# Overloads (5xx) and timeouts are usually over within seconds.
TRANSIENT_COOLDOWN_SECONDS = 30


@dataclass(frozen=True)
class LLMBackend:
    name: str
    provider: str  # "openai" | "openrouter" | "gemini"
    api_key: str
    model: str


def _setting(settings: Any, name: str, default: Any = None) -> Any:
    return getattr(settings, name, default)


def build_backends(settings: Any) -> list[LLMBackend]:
    """Ordered, de-duplicated list of every chat backend with a key."""
    openrouter_model = _setting(settings, "openrouter_chat_model", "anthropic/claude-haiku-4.5")
    candidates = {
        "openrouter": [
            ("openrouter", _setting(settings, "openrouter_api_key"), openrouter_model),
            ("openrouter-2", _setting(settings, "openrouter_api_key_2"), openrouter_model),
        ],
        "gemini": [
            ("gemini", _setting(settings, "gemini_api_key"),
             _setting(settings, "gemini_chat_model", "gemini-2.5-flash")),
        ],
        "openai": [
            ("openai", _setting(settings, "openai_api_key"),
             _setting(settings, "openai_chat_model", "gpt-4o-mini")),
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
            backends.append(LLMBackend(name=name, provider=provider, api_key=key, model=model))
    return backends


class KeyPool:
    """Process-wide rotation and cooldown state, shared by every request."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._turn = 0
        self._cooling_until: dict[str, float] = {}

    def order(self, backends: list[LLMBackend]) -> list[LLMBackend]:
        """Backends to try, healthy ones first in rotated order.

        Cooling backends go last (soonest to recover first) rather than being
        dropped, so a request still has a chance when every key is cooling.
        """
        if not backends:
            return []
        now = time.monotonic()
        with self._lock:
            start = self._turn % len(backends)
            self._turn += 1
            rotated = backends[start:] + backends[:start]
            healthy = [b for b in rotated if self._cooling_until.get(b.api_key, 0.0) <= now]
            cooling = sorted(
                (b for b in rotated if self._cooling_until.get(b.api_key, 0.0) > now),
                key=lambda b: self._cooling_until[b.api_key],
            )
        return healthy + cooling

    def mark_failed(self, backend: LLMBackend, status: int | None, *, timed_out: bool,
                    cooldown_seconds: int) -> bool:
        """Cool a backend down when its failure is likely to repeat. Returns True if cooled.

        Credit, auth and rate-limit failures cool for ``cooldown_seconds``; an
        overload or timeout usually clears in seconds, so it cools briefly.
        """
        if status is not None and status in COOLDOWN_STATUSES:
            seconds = cooldown_seconds
        elif timed_out or (status is not None and status >= 500):
            seconds = min(TRANSIENT_COOLDOWN_SECONDS, cooldown_seconds)
        else:
            return False
        with self._lock:
            self._cooling_until[backend.api_key] = time.monotonic() + seconds
        return True

    def mark_ok(self, backend: LLMBackend) -> None:
        with self._lock:
            self._cooling_until.pop(backend.api_key, None)

    def reset(self) -> None:
        with self._lock:
            self._turn = 0
            self._cooling_until.clear()


key_pool = KeyPool()

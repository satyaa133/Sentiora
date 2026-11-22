"""Chat-model keys Ask can use, rotated round-robin with failover.

Every configured chat key becomes a backend: the LLM_PROVIDER keys first
(for OpenRouter: OPENROUTER_API_KEY, then OPENROUTER_API_KEY_1..N), then any
other provider whose key is set. Calls rotate among the LLM_PROVIDER keys to
spread load; other providers are backups, tried in order only after every
primary key has failed or is cooling down. A backend that fails with an exhausted, revoked or rate-limited key (or
an overload/timeout) cools down with exponential backoff and is skipped, so an
answer never waits on a dead key. At most LLM_MAX_ATTEMPTS backends are tried
per call. Keys are never logged.
"""

from __future__ import annotations

import contextlib
import hashlib
import threading
import time
from dataclasses import dataclass
from typing import Any, cast

from redis import Redis

from app.core.config import openrouter_keys
from app.core.metrics import AI_PROVIDER_ERRORS, provider_error_reason
from app.core.redis_client import (
    KEY_PREFIX,
    RedisUnavailableError,
    SharedRedis,
    shared_redis,
)

# Statuses that mean "this key will keep failing for a while".
COOLDOWN_STATUSES = frozenset({401, 402, 403, 429})
DEFAULT_COOLDOWN_SECONDS = 300
DEFAULT_MAX_COOLDOWN_SECONDS = 3600
DEFAULT_MAX_ATTEMPTS = 4
# Sent as OpenRouter's `provider` preferences on every request: only endpoints
# that keep no data (zdr) and don't collect prompts for training. REBUILD_PLAN D13.
OPENROUTER_PRIVACY: dict[str, object] = {"data_collection": "deny", "zdr": True}
# Overloads (5xx) and timeouts are usually over within seconds.
TRANSIENT_COOLDOWN_SECONDS = 30


@dataclass(frozen=True)
class LLMBackend:
    name: str
    provider: str  # "openai" | "openrouter" | "groq" | "gemini"
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
        "groq": [
            (
                "groq",
                _setting(settings, "groq_api_key"),
                _setting(settings, "groq_chat_model", "openai/gpt-oss-120b"),
            ),
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
    # Backups after the primary: Groq first (fastest), then Gemini, then OpenAI.
    order = [primary] + [
        p for p in ("openrouter", "groq", "gemini", "openai") if p != primary
    ]

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


def _redis_keys(backend: LLMBackend) -> tuple[str, str]:
    """Redis keys for a backend's cooldown and failure count (a hash, never the key)."""
    digest = hashlib.sha256(backend.api_key.encode("utf-8")).hexdigest()[:24]
    return f"{KEY_PREFIX}llm:cooldown:{digest}", f"{KEY_PREFIX}llm:failures:{digest}"


class KeyPool:
    """Rotation and cooldown state, shared by every request.

    Cooldowns and failure counts are mirrored in Redis, so a key that fails in
    one API process or worker is skipped by all of them (a circuit breaker per
    key). Rotation stays per process. Without Redis, each process keeps its own
    state, as before.
    """

    def __init__(self, redis: SharedRedis = shared_redis) -> None:
        self._redis = redis
        self._lock = threading.Lock()
        # One round-robin turn per backend list, so embedding calls rotating
        # their keys do not shift which chat backend answers first.
        self._turns: dict[tuple[str, ...], int] = {}
        self._cooling_until: dict[str, float] = {}
        self._failures: dict[str, int] = {}

    def order(
        self, backends: list[LLMBackend], *, rotate: bool = True
    ) -> list[LLMBackend]:
        """Backends to try, healthy ones first.

        The keys of the first backend's provider (the primary, LLM_PROVIDER)
        rotate round-robin; backends of other providers follow in the given
        order, so a backup provider answers only when the primary keys can't.
        Cooling backends go last (soonest to recover first) rather than being
        dropped, so a request still has a chance when every key is cooling.
        ``rotate=False`` keeps the current turn, for secondary calls (such as
        answer metadata) that must not skew the round-robin between answers.
        """
        if not backends:
            return []
        primary_provider = backends[0].provider
        primary = [b for b in backends if b.provider == primary_provider]
        backups = [b for b in backends if b.provider != primary_provider]
        shared = self._shared_remaining(backends)
        now = time.monotonic()
        with self._lock:
            group = tuple(b.name for b in primary)
            turn = self._turns.get(group, 0)
            start = turn % len(primary)
            if rotate:
                self._turns[group] = turn + 1
            rotated = primary[start:] + primary[:start] + backups
            remaining = {
                b.api_key: max(
                    self._cooling_until.get(b.api_key, 0.0) - now,
                    shared.get(b.api_key, 0.0),
                )
                for b in rotated
            }
        healthy = [b for b in rotated if remaining[b.api_key] <= 0]
        cooling = sorted(
            (b for b in rotated if remaining[b.api_key] > 0),
            key=lambda b: remaining[b.api_key],
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
        AI_PROVIDER_ERRORS.labels(
            provider=backend.provider,
            reason=provider_error_reason(status, timed_out=timed_out),
        ).inc()
        if status is not None and status in COOLDOWN_STATUSES:
            base = cooldown_seconds
        elif timed_out or (status is not None and status >= 500):
            base = min(TRANSIENT_COOLDOWN_SECONDS, cooldown_seconds)
        else:
            return False
        cap = max(max_cooldown_seconds, base)
        shared_failures = self._shared_failure(backend, cap)
        with self._lock:
            failures = max(self._failures.get(backend.api_key, 0) + 1, shared_failures)
            self._failures[backend.api_key] = failures
            seconds = min(base * 2 ** (failures - 1), cap)
            if retry_after is not None and retry_after > seconds:
                seconds = min(retry_after, cap)
            self._cooling_until[backend.api_key] = time.monotonic() + seconds
        self._shared_cool(backend, seconds)
        return True

    def cooldown_remaining(self, backend: LLMBackend) -> float:
        shared = self._shared_remaining([backend]).get(backend.api_key, 0.0)
        with self._lock:
            local = self._cooling_until.get(backend.api_key, 0.0) - time.monotonic()
        return max(0.0, local, shared)

    def mark_ok(self, backend: LLMBackend) -> None:
        with self._lock:
            self._cooling_until.pop(backend.api_key, None)
            self._failures.pop(backend.api_key, None)
        cool_key, fail_key = _redis_keys(backend)
        with contextlib.suppress(RedisUnavailableError):
            self._redis.run(lambda client: client.delete(cool_key, fail_key))

    # -- shared state (Redis); every helper degrades to "nothing shared" -----

    def _shared_remaining(self, backends: list[LLMBackend]) -> dict[str, float]:
        """Seconds each backend still cools down according to Redis."""

        def read(client: Redis) -> list[int]:
            pipe = client.pipeline(transaction=False)
            for backend in backends:
                pipe.pttl(_redis_keys(backend)[0])
            return cast(list[int], pipe.execute())

        try:
            ttls = self._redis.run(read)
        except RedisUnavailableError:
            return {}
        return {
            backend.api_key: ttl / 1000
            for backend, ttl in zip(backends, ttls, strict=True)
            if ttl and ttl > 0
        }

    def _shared_failure(self, backend: LLMBackend, cap: float) -> int:
        """Count one more failure in Redis; 0 when Redis is unavailable."""
        fail_key = _redis_keys(backend)[1]

        def count(client: Redis) -> int:
            pipe = client.pipeline(transaction=True)
            pipe.incr(fail_key)
            # The count resets once the key has been quiet for the longest cooldown.
            pipe.expire(fail_key, int(cap) * 2)
            return int(pipe.execute()[0])

        try:
            return self._redis.run(count)
        except RedisUnavailableError:
            return 0

    def _shared_cool(self, backend: LLMBackend, seconds: float) -> None:
        cool_key = _redis_keys(backend)[0]
        with contextlib.suppress(RedisUnavailableError):
            self._redis.run(
                lambda client: client.set(cool_key, "1", px=max(1, int(seconds * 1000)))
            )

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

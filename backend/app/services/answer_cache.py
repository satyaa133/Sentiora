"""Answer cache: the same question on the same library gets the stored answer.

Two entries per question, in Redis for ``ANSWER_CACHE_TTL_SECONDS``:

- ``answer``: the finished answer events (sources and ``final``), per answer
  mode. A hit makes no retrieval and no model call.
- ``sources``: the retrieved chunks, shared by both modes, so "Explain with AI"
  answers from exactly the sources the instant answer showed, without a second
  retrieval.

The key covers the user, the normalised question, its scope (source type,
memory, ``top_k``), the earlier turns, the day in the user's time zone (for
"today" questions) and the library version. The version changes when a save
becomes searchable, is deleted or finishes enrichment; it deliberately ignores
``memory_items.updated_at``, which also changes when Ask queues enrichment and
would empty the cache on every question.

Redis is optional: when it is down nothing is cached.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from datetime import datetime, tzinfo
from typing import Any, cast
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session as DBSession

from app.core.config import get_settings
from app.core.redis_client import KEY_PREFIX, RedisUnavailableError, SharedRedis, shared_redis
from app.models.memory_item import ItemStatus, MemoryItem, SourceType
from app.schemas.ask import AskTurn
from app.services.retrieval_service import RetrievedChunk
import contextlib

logger = logging.getLogger(__name__)

_PREFIX = f"{KEY_PREFIX}answer:"
# Bump when the cached shape or the answer pipeline changes.
_FORMAT = "v1"


def normalize_question(question: str) -> str:
    text = " ".join(question.lower().split())
    return re.sub(r"[\s?!.]+$", "", text)


def library_version(db: DBSession, user_id: UUID) -> str:
    """Changes when the user's searchable library changes (see module docstring)."""
    row = db.execute(
        select(
            func.count().filter(
                MemoryItem.deleted_at.is_(None), MemoryItem.status == ItemStatus.ready
            ),
            func.max(MemoryItem.created_at),
            func.max(MemoryItem.deleted_at),
            func.max(MemoryItem.enriched_at),
        ).where(MemoryItem.user_id == user_id)
    ).one()
    return "|".join("" if value is None else str(value) for value in row)


@dataclass(frozen=True)
class CacheKey:
    retrieval: str  # shared by both answer modes

    def answer(self, mode: str) -> str:
        return f"{_PREFIX}{_FORMAT}:{mode}:{self.retrieval}"

    @property
    def sources(self) -> str:
        return f"{_PREFIX}{_FORMAT}:sources:{self.retrieval}"


def cache_key(
    *,
    user_id: UUID,
    question: str,
    source_type: SourceType | None,
    memory_id: UUID | None,
    top_k: int | None,
    history: Sequence[AskTurn],
    zone: tzinfo,
    version: str,
) -> CacheKey:
    parts = {
        "user": str(user_id),
        "q": normalize_question(question),
        "type": source_type.value if source_type else None,
        "memory": str(memory_id) if memory_id else None,
        "k": top_k,
        "history": [[t.role, " ".join(t.content.split())] for t in history],
        "day": datetime.now(zone).date().isoformat(),
        "zone": str(zone),
        "library": version,
    }
    digest = hashlib.sha256(
        json.dumps(parts, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    # The user id stays readable so one user's entries can be found.
    return CacheKey(f"{user_id}:{digest}")


def _chunk_to_json(chunk: RetrievedChunk) -> dict[str, Any]:
    data = asdict(chunk)
    data.pop("vector", None)
    data["chunk_id"] = str(chunk.chunk_id)
    data["memory_id"] = str(chunk.memory_id)
    data["source_type"] = chunk.source_type.value
    data["captured_at"] = chunk.captured_at.isoformat()
    return data


def _chunk_from_json(data: dict[str, Any]) -> RetrievedChunk:
    return RetrievedChunk(
        **{
            **data,
            "chunk_id": UUID(data["chunk_id"]),
            "memory_id": UUID(data["memory_id"]),
            "source_type": SourceType(data["source_type"]),
            "captured_at": datetime.fromisoformat(data["captured_at"]),
        }
    )


class AnswerCache:
    def __init__(self, redis: SharedRedis = shared_redis) -> None:
        self._redis = redis

    def _ttl(self) -> int:
        return int(get_settings().answer_cache_ttl_seconds)

    def _get(self, key: str) -> Any | None:
        if self._ttl() <= 0:
            return None
        try:
            # Sync client: the stubs type replies as "Awaitable | Any".
            raw = cast(bytes | None, self._redis.run(lambda client: client.get(key)))
        except RedisUnavailableError:
            return None
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except (TypeError, ValueError):
            return None

    def _set(self, key: str, value: Any) -> None:
        ttl = self._ttl()
        if ttl <= 0:
            return
        payload = json.dumps(value, separators=(",", ":"))
        with contextlib.suppress(RedisUnavailableError):
            self._redis.run(lambda client: client.set(key, payload, ex=ttl))

    def get_answer(self, key: CacheKey, mode: str) -> dict[str, Any] | None:
        value = self._get(key.answer(mode))
        return value if isinstance(value, dict) else None

    def set_answer(self, key: CacheKey, mode: str, value: dict[str, Any]) -> None:
        self._set(key.answer(mode), value)

    def get_sources(self, key: CacheKey) -> list[RetrievedChunk] | None:
        value = self._get(key.sources)
        if not isinstance(value, list):
            return None
        try:
            return [_chunk_from_json(item) for item in value]
        except (KeyError, TypeError, ValueError):
            logger.warning("Ignoring a malformed cached source list")
            return None

    def set_sources(self, key: CacheKey, chunks: Sequence[RetrievedChunk]) -> None:
        self._set(key.sources, [_chunk_to_json(chunk) for chunk in chunks])


answer_cache = AnswerCache()

"""Deleting an account and everything tied to it (REBUILD_PLAN D15, DPDP Act).

The user row is deleted with one statement; every table that belongs to a
user (memories, chunks, questions, answer feedback, AI usage rows, sessions,
refresh tokens, profile) has ``ON DELETE CASCADE`` to ``users``, so the
database removes the rest in the same transaction. Redis keys that carry the
user id (cached answers and sources, rate-limit windows) are removed after the
commit; a Redis outage leaves them to expire on their own (at most
``ANSWER_CACHE_TTL_SECONDS``), and they can never be read again because every
key includes the deleted user's id.
"""

from __future__ import annotations

import logging
from typing import cast
from uuid import UUID

from fastapi import HTTPException, status
from redis import Redis
from sqlalchemy import delete
from sqlalchemy.orm import Session as DBSession

from app.core.redis_client import KEY_PREFIX, RedisUnavailableError, shared_redis
from app.core.security import verify_password
from app.models.user import User

logger = logging.getLogger(__name__)

_WRONG_PASSWORD = {
    "code": "AUTH_INVALID_CREDENTIALS",
    "message": "That password is not right, so nothing was deleted.",
}


def _forget_redis_keys(user_id: UUID) -> int:
    """Delete every Sentiora Redis key that names this user; returns the count."""

    def run(client: Redis) -> int:
        # Sync client: the stubs type replies as "Awaitable | Any".
        removed = 0
        batch: list[bytes] = []
        for key in client.scan_iter(match=f"{KEY_PREFIX}*{user_id}*", count=500):
            batch.append(key)
            if len(batch) >= 500:
                removed += cast(int, client.delete(*batch))
                batch.clear()
        if batch:
            removed += cast(int, client.delete(*batch))
        return removed

    try:
        return int(shared_redis.run(run))
    except RedisUnavailableError:
        logger.warning("Redis unavailable: a deleted user's cache keys will expire on their own")
        return 0


class AccountService:
    def __init__(self, db: DBSession) -> None:
        self.db = db

    def delete_account(self, user: User, password: str) -> None:
        """Remove the user and all their data, after checking their password."""
        if not user.password_hash or not verify_password(password, user.password_hash):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail=_WRONG_PASSWORD)
        user_id = user.id
        self.db.execute(delete(User).where(User.id == user_id))
        self.db.commit()
        self.db.expunge_all()
        removed = _forget_redis_keys(user_id)
        logger.info("account deleted user=%s redis_keys=%s", user_id, removed)

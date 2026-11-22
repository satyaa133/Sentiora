"""Privacy notice consent (REBUILD_PLAN D10).

New users accept the notice at sign-up. When ``PRIVACY_NOTICE_VERSION``
changes, signed-in users accept the new version before their next AI request.
Everything that sends a user's text to an AI provider checks this: AI answers,
the Summarise button and background enrichment. Instant answers and search
run on our servers and never need it.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session as DBSession

from app.core.config import get_settings
from app.models.user import User

CONSENT_REQUIRED_DETAIL = {
    "code": "PRIVACY_CONSENT_REQUIRED",
    "message": (
        "AI features send your question and excerpts of your saves to our AI "
        "providers. Accept the current privacy notice to use them."
    ),
}


def current_notice_version() -> str:
    return get_settings().privacy_notice_version


def has_current_consent(user: User) -> bool:
    return user.privacy_consent_version == current_notice_version()


def user_has_current_consent(db: DBSession, user_id: UUID) -> bool:
    version = db.execute(
        select(User.privacy_consent_version).where(User.id == user_id)
    ).scalar_one_or_none()
    return version == current_notice_version()


def require_ai_consent(user: User) -> None:
    """403 ``PRIVACY_CONSENT_REQUIRED`` unless the user accepted the current notice."""
    if not has_current_consent(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail=CONSENT_REQUIRED_DETAIL)


def record_consent(db: DBSession, user: User, version: str) -> User:
    """Store acceptance of ``version``; it must be the current notice."""
    if version != current_notice_version():
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={
                "code": "VALIDATION_ERROR",
                "message": "That is not the current privacy notice. Reload and try again.",
            },
        )
    user.privacy_consent_version = version
    user.privacy_consented_at = datetime.now(UTC)
    db.commit()
    db.refresh(user)
    return user


def consent_fields(user: User) -> dict[str, object]:
    """``privacy_consent_version`` and ``privacy_consent_current`` for responses."""
    return {
        "privacy_consent_version": user.privacy_consent_version,
        "privacy_consent_current": has_current_consent(user),
    }

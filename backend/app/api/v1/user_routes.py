import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.orm import Session as DBSession

from app.api.deps import get_current_user, get_db
from app.models.user import User
from app.schemas.envelope import ResponseMeta
from app.schemas.source_preference import (
    BulkSourcePreferencesRequest,
    OnboardingCompleteRequest,
    SourceId,
    UpdateSourcePreferenceRequest,
)
from app.services.user_service import UserService

router = APIRouter(prefix="/users", tags=["Users"])


def _meta(request: Request) -> ResponseMeta:
    request_id = getattr(request.state, "request_id", f"req_{uuid.uuid4().hex[:8]}")
    return ResponseMeta(request_id=request_id)


def _serialize_profile(user: User) -> dict | None:
    if not user.profile:
        return None
    profile = user.profile
    return {
        "display_name": profile.display_name,
        "avatar_url": profile.avatar_url,
        "bio": profile.bio,
        "timezone": profile.timezone,
        "locale": profile.locale,
        "onboarding_completed": profile.onboarding_completed,
        "source_preferences": profile.source_preferences or {},
    }


@router.get(
    "/me",
    status_code=status.HTTP_200_OK,
    summary="Get full profile of the currently authenticated user",
)
def get_user_profile(
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict:
    return {
        "success": True,
        "data": {
            "id": str(current_user.id),
            "email": current_user.email,
            "is_email_verified": current_user.is_email_verified,
            "is_active": current_user.is_active,
            "profile": _serialize_profile(current_user),
            "onboarding_completed": bool(
                current_user.profile and current_user.profile.onboarding_completed
            ),
        },
        "meta": _meta(request).model_dump(),
    }


@router.get(
    "/me/source-preferences",
    status_code=status.HTTP_200_OK,
    summary="Get persisted connected source configuration",
)
def get_source_preferences(
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DBSession, Depends(get_db)],
) -> dict:
    service = UserService(db)
    prefs = service.get_source_preferences(current_user)
    return {
        "success": True,
        "data": {
            "sources": {key: value.value for key, value in prefs.sources.items()},
            "onboarding_completed": prefs.onboarding_completed,
        },
        "meta": _meta(request).model_dump(),
    }


@router.patch(
    "/me/source-preferences/{source_id}",
    status_code=status.HTTP_200_OK,
    summary="Update a single connected source status",
)
def update_source_preference(
    source_id: SourceId,
    body: UpdateSourcePreferenceRequest,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DBSession, Depends(get_db)],
) -> dict:
    service = UserService(db)
    prefs = service.update_source_status(current_user, source_id, body.status)
    return {
        "success": True,
        "data": {
            "sources": {key: value.value for key, value in prefs.sources.items()},
            "onboarding_completed": prefs.onboarding_completed,
        },
        "meta": _meta(request).model_dump(),
    }


@router.patch(
    "/me/source-preferences",
    status_code=status.HTTP_200_OK,
    summary="Bulk update connected source statuses",
)
def bulk_update_source_preferences(
    body: BulkSourcePreferencesRequest,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DBSession, Depends(get_db)],
) -> dict:
    service = UserService(db)
    prefs = service.bulk_update_sources(current_user, body.sources)
    return {
        "success": True,
        "data": {
            "sources": {key: value.value for key, value in prefs.sources.items()},
            "onboarding_completed": prefs.onboarding_completed,
        },
        "meta": _meta(request).model_dump(),
    }


@router.post(
    "/me/onboarding/complete",
    status_code=status.HTTP_200_OK,
    summary="Complete onboarding and persist initial source selections",
)
def complete_onboarding(
    body: OnboardingCompleteRequest,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DBSession, Depends(get_db)],
) -> dict:
    service = UserService(db)
    prefs = service.complete_onboarding(current_user, body)
    return {
        "success": True,
        "data": {
            "sources": {key: value.value for key, value in prefs.sources.items()},
            "onboarding_completed": prefs.onboarding_completed,
        },
        "meta": _meta(request).model_dump(),
    }

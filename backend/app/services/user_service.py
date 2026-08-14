from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session as DBSession

from app.models.user import User
from app.repositories.user_repository import UserRepository
from app.schemas.source_preference import (
    ALL_SOURCE_IDS,
    OnboardingCompleteRequest,
    SourceId,
    SourcePreferencesData,
    SourceStatus,
    default_source_preferences,
)


class UserService:
    def __init__(self, db: DBSession) -> None:
        self.repo = UserRepository(db)

    def _ensure_profile(self, user: User) -> None:
        if user.profile is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "code": "USER_PROFILE_NOT_FOUND",
                    "message": "User profile not found.",
                },
            )

    def _normalize_preferences(self, raw: dict | None) -> dict[str, SourceStatus]:
        base = default_source_preferences()
        if raw:
            for source_id in ALL_SOURCE_IDS:
                value = raw.get(source_id.value)
                if value in {s.value for s in SourceStatus}:
                    base[source_id.value] = SourceStatus(value)
        return {key: SourceStatus(value) for key, value in base.items()}

    def get_source_preferences(self, user: User) -> SourcePreferencesData:
        self._ensure_profile(user)
        profile = user.profile
        assert profile is not None
        return SourcePreferencesData(
            sources=self._normalize_preferences(profile.source_preferences),
            onboarding_completed=profile.onboarding_completed,
        )

    def update_source_status(
        self, user: User, source_id: SourceId, status_value: SourceStatus
    ) -> SourcePreferencesData:
        self._ensure_profile(user)
        profile = user.profile
        assert profile is not None

        preferences = self._normalize_preferences(profile.source_preferences)
        preferences[source_id.value] = status_value
        profile.source_preferences = {
            key: value.value for key, value in preferences.items()
        }
        self.repo.commit_profile(profile)
        return self.get_source_preferences(user)

    def bulk_update_sources(
        self, user: User, updates: dict[str, SourceStatus]
    ) -> SourcePreferencesData:
        self._ensure_profile(user)
        profile = user.profile
        assert profile is not None

        preferences = self._normalize_preferences(profile.source_preferences)
        for source_key, status_value in updates.items():
            try:
                source_id = SourceId(source_key)
            except ValueError as exc:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail={
                        "code": "VALIDATION_ERROR",
                        "message": f"Unknown source id: {source_key}",
                    },
                ) from exc
            preferences[source_id.value] = status_value

        profile.source_preferences = {
            key: value.value for key, value in preferences.items()
        }
        self.repo.commit_profile(profile)
        return self.get_source_preferences(user)

    def complete_onboarding(
        self, user: User, req: OnboardingCompleteRequest
    ) -> SourcePreferencesData:
        self._ensure_profile(user)
        profile = user.profile
        assert profile is not None

        preferences = default_source_preferences()
        selected = {source.value for source in req.selected_sources}
        for source_id in ALL_SOURCE_IDS:
            if source_id.value in selected:
                preferences[source_id.value] = SourceStatus.ACTIVE.value

        profile.source_preferences = preferences
        profile.onboarding_completed = True
        self.repo.commit_profile(profile)
        return self.get_source_preferences(user)

    def get_user_by_id(self, user_id: UUID) -> User | None:
        return self.repo.get_by_id(user_id)

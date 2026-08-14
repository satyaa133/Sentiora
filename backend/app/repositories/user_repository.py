from typing import cast
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session as DBSession, selectinload

from app.models.user import User, UserProfile
from datetime import UTC


class UserRepository:
    def __init__(self, db: DBSession) -> None:
        self.db = db

    def get_by_id(self, user_id: UUID) -> User | None:
        result = self.db.execute(
            select(User)
            .options(selectinload(User.profile))
            .where(User.id == user_id, User.deleted_at.is_(None))
        ).scalar_one_or_none()
        return cast(User | None, result)

    def get_by_email(self, email: str) -> User | None:
        result = self.db.execute(
            select(User).where(User.email == email.lower(), User.deleted_at.is_(None))
        ).scalar_one_or_none()
        return cast(User | None, result)

    def create_user(
        self,
        email: str,
        password_hash: str | None,
        full_name: str | None = None,
    ) -> User:
        user = User(
            email=email.lower(),
            password_hash=password_hash,
            is_email_verified=False,
            is_active=True,
        )
        self.db.add(user)
        self.db.flush()

        profile = UserProfile(
            user_id=user.id,
            display_name=full_name,
        )
        self.db.add(profile)
        self.db.commit()
        self.db.refresh(user)
        return user

    def update_last_login(self, user: User) -> None:
        from datetime import datetime

        user.last_login_at = datetime.now(UTC)
        self.db.commit()

    def update_password(self, user: User, password_hash: str) -> None:
        user.password_hash = password_hash
        self.db.commit()

    def commit_profile(self, profile: UserProfile) -> None:
        self.db.commit()
        self.db.refresh(profile)

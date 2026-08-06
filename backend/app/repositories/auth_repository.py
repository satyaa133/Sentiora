from typing import cast
from datetime import datetime
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.orm import Session as DBSession

from app.models.session import RefreshToken, Session


class AuthRepository:
    def __init__(self, db: DBSession) -> None:
        self.db = db

    def create_session(
        self,
        user_id: UUID,
        expires_at: datetime,
        device_label: str | None = None,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> Session:
        session = Session(
            user_id=user_id,
            device_label=device_label,
            ip_address=ip_address,
            user_agent=user_agent,
            expires_at=expires_at,
            is_active=True,
        )
        self.db.add(session)
        self.db.commit()
        self.db.refresh(session)
        return session

    def create_refresh_token(
        self,
        user_id: UUID,
        session_id: UUID | None,
        token_hash: str,
        expires_at: datetime,
    ) -> RefreshToken:
        refresh_token = RefreshToken(
            user_id=user_id,
            session_id=session_id,
            token_hash=token_hash,
            expires_at=expires_at,
            is_revoked=False,
        )
        self.db.add(refresh_token)
        self.db.commit()
        self.db.refresh(refresh_token)
        return refresh_token

    def get_refresh_token_by_hash(self, token_hash: str) -> RefreshToken | None:
        result = self.db.execute(
            select(RefreshToken).where(RefreshToken.token_hash == token_hash)
        ).scalar_one_or_none()
        return cast(RefreshToken | None, result)

    def revoke_refresh_token(self, token_record: RefreshToken) -> None:
        token_record.is_revoked = True
        self.db.commit()

    def revoke_user_token_family(self, user_id: UUID) -> None:
        self.db.execute(
            update(RefreshToken)
            .where(RefreshToken.user_id == user_id, RefreshToken.is_revoked.is_(False))
            .values(is_revoked=True)
        )
        self.db.commit()

    def deactivate_session(self, session_id: UUID) -> None:
        self.db.execute(
            update(Session).where(Session.id == session_id).values(is_active=False)
        )
        self.db.commit()

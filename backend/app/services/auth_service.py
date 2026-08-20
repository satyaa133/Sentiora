from datetime import datetime, timedelta, UTC
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session as DBSession

from app.core.config import get_settings
from app.core.login_backoff import login_backoff
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_jwt_token,
    hash_password,
    hash_refresh_token,
    verify_password,
)
from app.repositories.auth_repository import AuthRepository
from app.repositories.user_repository import UserRepository
from app.schemas.auth import (
    AuthTokenData,
    AuthUserInfo,
    ChangePasswordRequest,
    LoginRequest,
    RegisterRequest,
    RegisterResponseData,
)

settings = get_settings()


class AuthService:
    def __init__(self, db: DBSession) -> None:
        self.db = db
        self.user_repo = UserRepository(db)
        self.auth_repo = AuthRepository(db)

    def register(self, req: RegisterRequest) -> RegisterResponseData:
        existing_user = self.user_repo.get_by_email(req.email)
        if existing_user:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "AUTH_EMAIL_ALREADY_EXISTS",
                    "message": "An account with this email address already exists.",
                },
            )

        hashed_pwd = hash_password(req.password)
        user = self.user_repo.create_user(
            email=req.email,
            password_hash=hashed_pwd,
            full_name=req.full_name,
        )

        return RegisterResponseData(
            user_id=user.id,
            email=user.email,
            email_verified=user.is_email_verified,
        )

    def login(
        self,
        req: LoginRequest,
        device_label: str | None = None,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> AuthTokenData:
        login_backoff.precheck(req.email, ip_address)
        user = self.user_repo.get_by_email(req.email)
        if (
            not user
            or not user.password_hash
            or not verify_password(req.password, user.password_hash)
        ):
            login_backoff.record_failure(req.email, ip_address)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={
                    "code": "AUTH_INVALID_CREDENTIALS",
                    "message": "Invalid email or password.",
                },
            )

        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "AUTH_ACCOUNT_DISABLED",
                    "message": "This account has been disabled.",
                },
            )

        login_backoff.record_success(req.email, ip_address)

        session_expires = datetime.now(UTC) + timedelta(
            days=settings.refresh_token_expire_days
        )
        session = self.auth_repo.create_session(
            user_id=user.id,
            expires_at=session_expires,
            device_label=device_label,
            ip_address=ip_address,
            user_agent=user_agent,
        )

        access_token = create_access_token(user_id=str(user.id))
        refresh_token = create_refresh_token(user_id=str(user.id))
        token_hash = hash_refresh_token(refresh_token)

        self.auth_repo.create_refresh_token(
            user_id=user.id,
            session_id=session.id,
            token_hash=token_hash,
            expires_at=session_expires,
        )

        self.user_repo.update_last_login(user)

        full_name = user.profile.display_name if user.profile else None

        return AuthTokenData(
            access_token=access_token,
            refresh_token=refresh_token,
            access_token_expires_in=settings.access_token_expire_minutes * 60,
            user=AuthUserInfo(
                id=user.id,
                email=user.email,
                full_name=full_name,
            ),
        )

    def refresh_tokens(self, refresh_token_str: str) -> AuthTokenData:
        try:
            payload = decode_jwt_token(refresh_token_str)
            if payload.get("type") != "refresh":
                raise ValueError("Not a refresh token")
            user_id_str = payload.get("sub")
            if not user_id_str:
                raise ValueError("Missing subject in token")
            user_id = UUID(user_id_str)
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={
                    "code": "AUTH_TOKEN_INVALID",
                    "message": "The refresh token is invalid or expired.",
                },
            ) from None

        token_hash = hash_refresh_token(refresh_token_str)
        token_record = self.auth_repo.get_refresh_token_by_hash(token_hash)

        if not token_record or token_record.is_revoked:
            # Replay attack or revoked token -> revoke entire family
            self.auth_repo.revoke_user_token_family(user_id)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={
                    "code": "AUTH_TOKEN_REVOKED",
                    "message": "Token reuse detected. All sessions revoked for security.",
                },
            )

        if token_record.expires_at < datetime.now(UTC):
            self.auth_repo.revoke_refresh_token(token_record)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={
                    "code": "AUTH_TOKEN_EXPIRED",
                    "message": "Refresh token has expired. Please login again.",
                },
            )

        # Rotate refresh token: revoke current, issue new pair
        self.auth_repo.revoke_refresh_token(token_record)

        new_access_token = create_access_token(user_id=str(user_id))
        new_refresh_token = create_refresh_token(user_id=str(user_id))
        new_token_hash = hash_refresh_token(new_refresh_token)

        expires_at = datetime.now(UTC) + timedelta(
            days=settings.refresh_token_expire_days
        )
        self.auth_repo.create_refresh_token(
            user_id=user_id,
            session_id=token_record.session_id,
            token_hash=new_token_hash,
            expires_at=expires_at,
        )

        return AuthTokenData(
            access_token=new_access_token,
            refresh_token=new_refresh_token,
            access_token_expires_in=settings.access_token_expire_minutes * 60,
        )

    def logout(self, user_id: UUID) -> None:
        self.auth_repo.revoke_user_token_family(user_id)

    def change_password(self, user_id: UUID, req: ChangePasswordRequest) -> None:
        user = self.user_repo.get_by_id(user_id)
        if (
            not user
            or not user.password_hash
            or not verify_password(req.current_password, user.password_hash)
        ):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={
                    "code": "AUTH_INVALID_CREDENTIALS",
                    "message": "Current password is incorrect.",
                },
            )
        new_hash = hash_password(req.new_password)
        self.user_repo.update_password(user, new_hash)
        self.auth_repo.revoke_user_token_family(user_id)

import hashlib
import uuid
from datetime import datetime, timedelta, UTC
from typing import Any

import bcrypt
import jwt
from passlib.context import CryptContext  # type: ignore[import-untyped]

from app.core.config import get_settings

# passlib 1.7.x reads bcrypt.__about__.__version__, which bcrypt 4.1+ removed.
if not hasattr(bcrypt, "__about__"):
    class _BcryptAbout:
        __version__ = getattr(bcrypt, "__version__", "4.2.0")

    bcrypt.__about__ = _BcryptAbout()  # type: ignore[attr-defined]

settings = get_settings()

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return str(pwd_context.hash(password))


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bool(pwd_context.verify(plain_password, hashed_password))
    except ValueError:
        return False


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_access_token(user_id: str, expires_delta: timedelta | None = None) -> str:
    now = datetime.now(UTC)
    if expires_delta:
        expire = now + expires_delta
    else:
        expire = now + timedelta(minutes=settings.access_token_expire_minutes)

    payload = {
        "sub": user_id,
        "type": "access",
        "iat": now,
        "exp": expire,
        "jti": uuid.uuid4().hex,
    }
    return jwt.encode(
        payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm
    )


def create_refresh_token(user_id: str, expires_delta: timedelta | None = None) -> str:
    now = datetime.now(UTC)
    if expires_delta:
        expire = now + expires_delta
    else:
        expire = now + timedelta(days=settings.refresh_token_expire_days)

    payload = {
        "sub": user_id,
        "type": "refresh",
        "iat": now,
        "exp": expire,
        "jti": uuid.uuid4().hex,
    }
    return jwt.encode(
        payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm
    )


def decode_jwt_token(token: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm],
        )
        return payload
    except jwt.PyJWTError as e:
        raise ValueError(f"Invalid token: {e}") from e

import re
from typing import Annotated
from uuid import UUID

from pydantic import AfterValidator, BaseModel, ConfigDict, EmailStr, Field


def _check_password_strength(v: str) -> str:
    if not re.search(r"[A-Z]", v):
        raise ValueError("Must contain at least one uppercase letter.")
    if not re.search(r"[0-9]", v):
        raise ValueError("Must contain at least one number.")
    return v


StrongPassword = Annotated[str, Field(min_length=10), AfterValidator(_check_password_strength)]


class RegisterRequest(BaseModel):
    email: EmailStr
    password: StrongPassword
    full_name: str = Field(min_length=2, max_length=80)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RefreshTokenRequest(BaseModel):
    refresh_token: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    reset_token: str
    new_password: StrongPassword


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: StrongPassword


class RegisterResponseData(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: UUID
    email: EmailStr
    email_verified: bool = False


class AuthUserInfo(BaseModel):
    id: UUID
    email: EmailStr
    full_name: str | None = None


class AuthTokenData(BaseModel):
    access_token: str
    refresh_token: str
    access_token_expires_in: int = 900
    user: AuthUserInfo | None = None

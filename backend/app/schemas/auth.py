import re
from typing import Annotated
from uuid import UUID

from pydantic import AfterValidator, BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.core.config import get_settings


TRUSTED_EMAIL_DOMAINS = {
    "gmail.com",
    "googlemail.com",
    "outlook.com",
    "hotmail.com",
    "live.com",
    "msn.com",
    "yahoo.com",
    "ymail.com",
    "rocketmail.com",
    "icloud.com",
    "me.com",
    "mac.com",
    "proton.me",
    "protonmail.com",
    "fastmail.com",
    "zoho.com",
    "zohomail.com",
    "aol.com",
    "gmx.com",
    "mail.com",
}

# Reserved example domains: accepted only when ALLOW_TEST_EMAIL_DOMAINS is on
# (the test suite and the e2e stack), never in a normal deployment.
TEST_EMAIL_DOMAINS = {"example.com", "example.dev"}

EDU_DOMAIN_SUFFIXES = (
    ".edu",
    ".ac.uk",
    ".edu.in",
    ".edu.au",
)


def _check_trusted_email(v: EmailStr) -> EmailStr:
    email_str = str(v).strip().lower()
    domain = email_str.split("@")[-1]
    if domain in TRUSTED_EMAIL_DOMAINS or domain.endswith(EDU_DOMAIN_SUFFIXES):
        return v
    if domain in TEST_EMAIL_DOMAINS and get_settings().allow_test_email_domains:
        return v
    raise ValueError(
        "Please use a valid email address."
    )


TrustedEmail = Annotated[EmailStr, AfterValidator(_check_trusted_email)]


def _check_password_strength(v: str) -> str:
    if not re.search(r"[A-Z]", v):
        raise ValueError("Must contain at least one uppercase letter.")
    if not re.search(r"[0-9]", v):
        raise ValueError("Must contain at least one number.")
    return v


StrongPassword = Annotated[str, Field(min_length=10), AfterValidator(_check_password_strength)]


class RegisterRequest(BaseModel):
    email: TrustedEmail
    password: StrongPassword
    full_name: str = Field(min_length=2, max_length=80)
    # The privacy notice the user accepted (D10); must be the current version.
    privacy_consent_version: str = Field(min_length=1, max_length=32)

    @field_validator("privacy_consent_version")
    @classmethod
    def _current_notice(cls, value: str) -> str:
        if value != get_settings().privacy_notice_version:
            raise ValueError("must be the current privacy notice version")
        return value


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

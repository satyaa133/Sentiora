from uuid import UUID
from pydantic import BaseModel, ConfigDict, EmailStr


class UserProfileData(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    display_name: str | None = None
    avatar_url: str | None = None
    bio: str | None = None
    timezone: str = "UTC"
    locale: str = "en-US"
    onboarding_completed: bool = False
    source_preferences: dict[str, str] = {}


class UserResponseData(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: EmailStr
    is_email_verified: bool = False
    profile: UserProfileData | None = None

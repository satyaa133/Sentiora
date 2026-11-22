from pydantic import BaseModel, Field


class PrivacyConsentRequest(BaseModel):
    """The privacy notice version the user accepted (D10)."""

    version: str = Field(min_length=1, max_length=32)

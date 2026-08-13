from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.memory_item import ItemStatus, SourceType


class MemoryItemCreate(BaseModel):
    """Payload sent by the Chrome extension to ingest a captured page."""

    source_type: SourceType
    url: str = Field(..., min_length=1)
    title: str = Field(..., min_length=1)
    content: str | None = Field(default=None)
    author: str | None = Field(default=None)
    favicon_url: str | None = Field(default=None)
    thumbnail_url: str | None = Field(default=None)

    @field_validator("url", mode="before")
    @classmethod
    def sanitize_url(cls, v: object) -> str:
        if not isinstance(v, str) or not v.strip():
            return "https://unknown"
        return v.strip()[:2048]

    @field_validator("title", mode="before")
    @classmethod
    def sanitize_title(cls, v: object) -> str:
        if not isinstance(v, str) or not v.strip():
            return "Untitled Page"
        return v.strip()[:1024]

    @field_validator("author", mode="before")
    @classmethod
    def sanitize_author(cls, v: object) -> str | None:
        if not isinstance(v, str) or not v.strip():
            return None
        return v.strip()[:512]

    @field_validator("favicon_url", "thumbnail_url", mode="before")
    @classmethod
    def sanitize_image_url(cls, v: object) -> str | None:
        if not isinstance(v, str) or not v.strip():
            return None
        val = v.strip()
        if val.startswith("data:") or len(val) > 2048:
            return None
        return val[:2048]


class MemoryItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    source_type: SourceType
    url: str
    title: str
    content: str | None
    summary: str | None
    author: str | None
    favicon_url: str | None
    thumbnail_url: str | None
    word_count: int
    reading_time_seconds: int
    status: ItemStatus
    captured_at: datetime
    created_at: datetime


class MemoryItemListResponse(BaseModel):
    items: list[MemoryItemResponse]
    total: int
    page: int
    per_page: int
    has_more: bool

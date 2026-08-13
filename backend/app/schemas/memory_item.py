from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.memory_item import ItemStatus, SourceType


class MemoryItemCreate(BaseModel):
    """Payload sent by the Chrome extension to ingest a captured page."""

    source_type: SourceType
    url: str = Field(..., min_length=1, max_length=2048)
    title: str = Field(..., min_length=1, max_length=1024)
    content: str | None = Field(default=None, max_length=100_000)
    author: str | None = Field(default=None, max_length=512)
    favicon_url: str | None = Field(default=None, max_length=2048)
    thumbnail_url: str | None = Field(default=None, max_length=2048)


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
    domain: str | None = None
    language: str | None = None
    content_length: int = 0
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

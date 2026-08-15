from datetime import datetime
from uuid import UUID
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.memory_item import ItemStatus, SourceType


class NodeMetadata(BaseModel):
    level: int | None = None
    language: str | None = None
    page_number: int | None = None
    start_seconds: float | None = None
    end_seconds: float | None = None
    row_index: int | None = None
    col_index: int | None = None
    list_style: Literal["ordered", "unordered"] | None = None


class StructuredNode(BaseModel):
    id: str
    type: Literal["heading", "paragraph", "list_item", "code_block", "table", "blockquote"]
    text: str
    order: int
    parent_id: str | None = None
    metadata: NodeMetadata | None = None

    @field_validator("text", mode="after")
    @classmethod
    def trim_text(cls, v: str) -> str:
        return v.strip()


class ExtractionMetadata(BaseModel):
    method: Literal["readability", "youtube_transcript", "pdf_js", "fallback_scraper"]
    duration_ms: int = Field(..., ge=0)
    status: Literal["success", "partial", "failed", "insufficient_content"]
    quality_score: float = Field(..., ge=0.0, le=1.0)
    quality_reasons: list[str] = Field(default_factory=list)


class MemoryItemCreate(BaseModel):
    """Payload sent by the Chrome extension to ingest a captured page."""

    source_type: SourceType
    url: str = Field(..., min_length=1, max_length=2048)
    title: str = Field(..., min_length=1, max_length=1024)
    content: str | None = Field(default=None, max_length=100_000)
    author: str | None = Field(default=None, max_length=512)
    favicon_url: str | None = Field(default=None, max_length=2048)
    thumbnail_url: str | None = Field(default=None, max_length=2048)
    captured_at: datetime | None = None

    # New fields for Capture v2
    structured_content: list[StructuredNode] | None = None
    extraction: ExtractionMetadata | None = None

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
    domain: str | None = None
    language: str | None = None
    content_length: int = 0
    word_count: int
    reading_time_seconds: int
    status: ItemStatus
    processing_error: str | None = None
    captured_at: datetime
    created_at: datetime

    # New Response fields for Capture v2
    structured_content: list[StructuredNode] | None = None
    content_hash: str | None = None
    extraction_method: str | None = None
    extraction_status: str | None = None
    extraction_quality_score: float | None = None
    extraction_quality_reasons: list[str] | None = None
    raw_content_length: int = 0
    received_at: datetime | None = None


class MemoryItemListResponse(BaseModel):
    items: list[MemoryItemResponse]
    total: int
    page: int
    per_page: int
    has_more: bool

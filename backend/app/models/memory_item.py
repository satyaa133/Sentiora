import enum
import uuid
from datetime import datetime, UTC

from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text, Float
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base

if TYPE_CHECKING:
    from app.models.memory_chunk import MemoryChunk


def _utc_now() -> datetime:
    return datetime.now(UTC)


class SourceType(enum.StrEnum):
    webpage = "webpage"
    pdf = "pdf"
    youtube = "youtube"


class ItemStatus(enum.StrEnum):
    pending = "pending"
    processing = "processing"
    ready = "ready"
    failed = "failed"


class MemoryItem(Base):
    __tablename__ = "memory_items"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    source_type: Mapped[SourceType] = mapped_column(
        Enum(SourceType, name="sourcetype"), nullable=False, index=True
    )
    url: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    author: Mapped[str | None] = mapped_column(Text, nullable=True)
    favicon_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    thumbnail_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    domain: Mapped[str | None] = mapped_column(String(255), nullable=True)
    language: Mapped[str | None] = mapped_column(String(16), nullable=True)
    content_length: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    word_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    reading_time_seconds: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False
    )
    status: Mapped[ItemStatus] = mapped_column(
        Enum(ItemStatus, name="itemstatus"),
        default=ItemStatus.pending,
        nullable=False,
        index=True,
    )
    captured_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utc_now, nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utc_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utc_now, onupdate=_utc_now, nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    processing_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Capture v2 schema enhancements
    structured_content: Mapped[list | dict | None] = mapped_column(JSONB, nullable=True)
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    extraction_method: Mapped[str | None] = mapped_column(String(50), nullable=True)
    extraction_status: Mapped[str | None] = mapped_column(String(30), nullable=True)
    extraction_quality_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    extraction_quality_reasons: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    raw_content_length: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utc_now, nullable=False
    )

    chunks: Mapped[list["MemoryChunk"]] = relationship(
        "MemoryChunk",
        back_populates="memory_item",
        cascade="all, delete-orphan",
        order_by="MemoryChunk.chunk_index",
    )

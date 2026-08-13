import uuid
from datetime import datetime, UTC
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import ENUM, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.memory_item import SourceType

if TYPE_CHECKING:
    from app.models.memory_item import MemoryItem


def _utc_now() -> datetime:
    return datetime.now(UTC)


class MemoryChunk(Base):
    """Searchable unit derived from a captured memory. Embeddings are Phase 5."""

    __tablename__ = "memory_chunks"
    __table_args__ = (
        UniqueConstraint("memory_id", "chunk_index", name="uq_memory_chunks_memory_index"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    memory_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("memory_items.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    heading: Mapped[str | None] = mapped_column(Text, nullable=True)
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_type: Mapped[SourceType] = mapped_column(
        ENUM(SourceType, name="sourcetype", create_type=False),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utc_now, nullable=False
    )

    memory_item: Mapped["MemoryItem"] = relationship(
        "MemoryItem", back_populates="chunks"
    )

import uuid
from datetime import datetime, UTC
from typing import TYPE_CHECKING

from sqlalchemy import (
    Computed,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ENUM, TSVECTOR, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from pgvector.sqlalchemy import Vector

from app.core.db import Base
from app.models.memory_item import SourceType

if TYPE_CHECKING:
    from app.models.memory_item import MemoryItem


def _utc_now() -> datetime:
    return datetime.now(UTC)


class MemoryChunk(Base):
    """Searchable unit derived from a captured memory."""

    __tablename__ = "memory_chunks"
    __table_args__ = (
        UniqueConstraint("memory_id", "chunk_index", name="uq_memory_chunks_memory_index"),
        Index("ix_memory_chunks_user_memory", "user_id", "memory_id"),
        Index(
            "ix_memory_chunks_embedding_hnsw",
            "embedding",
            postgresql_using="hnsw",
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
        Index("ix_memory_chunks_content_tsv", "content_tsv", postgresql_using="gin"),
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
    embedding: Mapped[list[float] | None] = mapped_column(Vector(1536), nullable=True)
    # Transcript time range in seconds; null for non-video chunks.
    start_sec: Mapped[float | None] = mapped_column(Float, nullable=True)
    end_sec: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Which model produced ``embedding``; queries only compare same-model vectors.
    embedding_model: Mapped[str | None] = mapped_column(String(128), nullable=True)
    content_tsv: Mapped[str | None] = mapped_column(
        TSVECTOR,
        Computed(
            "setweight(to_tsvector('english', coalesce(heading, '')), 'B') || "
            "setweight(to_tsvector('english', content), 'A')",
            persisted=True,
        ),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utc_now, nullable=False
    )

    memory_item: Mapped["MemoryItem"] = relationship(
        "MemoryItem", back_populates="chunks"
    )

import uuid
from datetime import UTC, datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.config import LOCAL_VECTOR_DIMENSIONS
from app.core.db import Base


def _utc_now() -> datetime:
    return datetime.now(UTC)


class MemoryQuestion(Base):
    """A question a save answers, written by enrichment (REBUILD_PLAN S5).

    Embedded with the local model so a user's question can be matched with the
    questions their saves answer (the question-bank retrieval leg, S6).
    """

    __tablename__ = "memory_questions"

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
    # The chunk that answers the question; kept (as null) if chunks are rebuilt.
    chunk_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("memory_chunks.id", ondelete="SET NULL"),
        nullable=True,
    )
    question: Mapped[str] = mapped_column(Text, nullable=False)
    embedding_local: Mapped[list[float] | None] = mapped_column(
        Vector(LOCAL_VECTOR_DIMENSIONS), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utc_now, nullable=False
    )

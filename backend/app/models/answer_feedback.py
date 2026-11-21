import uuid
from datetime import UTC, datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, SmallInteger, String, Text
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


def _utc_now() -> datetime:
    return datetime.now(UTC)


class AnswerFeedback(Base):
    """A 👍 (+1) or 👎 (-1) on an Ask answer. Stores a hash of the question, not its text."""

    __tablename__ = "answer_feedback"
    __table_args__ = (
        CheckConstraint("rating IN (-1, 1)", name="ck_answer_feedback_rating"),
        CheckConstraint(
            "comment IS NULL OR char_length(comment) <= 1000",
            name="ck_answer_feedback_comment_length",
        ),
        Index("ix_answer_feedback_user_created", "user_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # SHA-256 (hex) of the normalised question.
    question_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    answer_mode: Mapped[str] = mapped_column(String(16), nullable=False)
    rating: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    # The chunks the answer cited; no foreign key, so deleting a memory keeps the rating.
    source_chunk_ids: Mapped[list[uuid.UUID]] = mapped_column(
        ARRAY(UUID(as_uuid=True)), nullable=False, default=list
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utc_now
    )

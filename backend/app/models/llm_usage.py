import uuid
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

USAGE_PURPOSES = ("answer", "enrich", "rewrite", "embed")


def _utc_now() -> datetime:
    return datetime.now(UTC)


class LLMUsage(Base):
    """One row per call to an external AI provider (cost tracking, later plan limits)."""

    __tablename__ = "llm_usage"
    __table_args__ = (
        CheckConstraint(
            "purpose IN ('answer', 'enrich', 'rewrite', 'embed')",
            name="ck_llm_usage_purpose",
        ),
        Index("ix_llm_usage_user_created", "user_id", "created_at"),
        Index("ix_llm_usage_created", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # Null for calls not made for one user (none today; kept for system jobs).
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    purpose: Mapped[str] = mapped_column(String(16), nullable=False)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    model: Mapped[str] = mapped_column(String(128), nullable=False)
    tokens_in: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tokens_out: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # As reported by the provider (OpenRouter usage accounting); null otherwise.
    cost_usd: Mapped[Decimal | None] = mapped_column(Numeric(16, 10), nullable=True)
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    success: Mapped[bool] = mapped_column(Boolean, nullable=False)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utc_now
    )

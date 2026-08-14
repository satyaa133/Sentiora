"""memory_chunks table and memory_items processing metadata

Revision ID: 004_memory_chunks
Revises: 003_user_source_preferences
Create Date: 2026-08-13 23:20:00.000000
"""

from collections.abc import Sequence

import alembic.op as op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "004_memory_chunks"
down_revision: str | None = "003_user_source_preferences"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("memory_items", sa.Column("domain", sa.String(length=255), nullable=True))
    op.add_column("memory_items", sa.Column("language", sa.String(length=16), nullable=True))
    op.add_column(
        "memory_items",
        sa.Column("content_length", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column("memory_items", sa.Column("processing_error", sa.Text(), nullable=True))

    source_type_enum = postgresql.ENUM(
        "webpage", "pdf", "youtube", name="sourcetype", create_type=False
    )

    op.create_table(
        "memory_chunks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "memory_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("memory_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("heading", sa.Text(), nullable=True),
        sa.Column("page_number", sa.Integer(), nullable=True),
        sa.Column("source_type", source_type_enum, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("memory_id", "chunk_index", name="uq_memory_chunks_memory_index"),
    )
    op.create_index("ix_memory_chunks_memory_id", "memory_chunks", ["memory_id"])
    op.create_index("ix_memory_chunks_user_id", "memory_chunks", ["user_id"])
    op.create_index(
        "ix_memory_chunks_user_memory",
        "memory_chunks",
        ["user_id", "memory_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_memory_chunks_user_memory", table_name="memory_chunks")
    op.drop_index("ix_memory_chunks_user_id", table_name="memory_chunks")
    op.drop_index("ix_memory_chunks_memory_id", table_name="memory_chunks")
    op.drop_table("memory_chunks")
    op.drop_column("memory_items", "processing_error")
    op.drop_column("memory_items", "content_length")
    op.drop_column("memory_items", "language")
    op.drop_column("memory_items", "domain")

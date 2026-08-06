"""memory_items table

Revision ID: 002_memory_items
Revises: 001_initial_auth
Create Date: 2026-08-05 20:00:00.000000
"""

from collections.abc import Sequence

import alembic.op as op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "002_memory_items"
down_revision: str | None = "001_initial_auth"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    source_type_enum = postgresql.ENUM("webpage", "pdf", "youtube", name="sourcetype", create_type=False)
    item_status_enum = postgresql.ENUM("pending", "processing", "ready", "failed", name="itemstatus", create_type=False)

    op.execute("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sourcetype') THEN CREATE TYPE sourcetype AS ENUM ('webpage', 'pdf', 'youtube'); END IF; END $$;")
    op.execute("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'itemstatus') THEN CREATE TYPE itemstatus AS ENUM ('pending', 'processing', 'ready', 'failed'); END IF; END $$;")

    op.create_table(
        "memory_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("source_type", source_type_enum, nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("author", sa.Text(), nullable=True),
        sa.Column("favicon_url", sa.Text(), nullable=True),
        sa.Column("thumbnail_url", sa.Text(), nullable=True),
        sa.Column("word_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("reading_time_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", item_status_enum, nullable=False, server_default="pending"),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_index("ix_memory_items_user_id", "memory_items", ["user_id"])
    op.create_index("ix_memory_items_status", "memory_items", ["status"])
    op.create_index("ix_memory_items_source_type", "memory_items", ["source_type"])
    op.create_index("ix_memory_items_captured_at", "memory_items", ["captured_at"])
    op.create_index("ix_memory_items_deleted_at", "memory_items", ["deleted_at"])


def downgrade() -> None:
    op.drop_table("memory_items")
    op.execute("DROP TYPE IF EXISTS itemstatus")
    op.execute("DROP TYPE IF EXISTS sourcetype")

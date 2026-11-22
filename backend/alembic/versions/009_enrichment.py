"""S5 save pipeline v3: enrichment fields, chunk context lines, question bank

Revision ID: 009_enrichment
Revises: 008_local_embeddings
Create Date: 2026-11-21 23:00:00.000000
"""

from collections.abc import Sequence

import alembic.op as op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects import postgresql

revision: str = "009_enrichment"
down_revision: str | None = "008_local_embeddings"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

LOCAL_DIMENSIONS = 768


def upgrade() -> None:
    op.add_column("memory_items", sa.Column("key_points", postgresql.JSONB(), nullable=True))
    op.add_column(
        "memory_items",
        sa.Column(
            "enrichment_status", sa.String(length=16), nullable=False, server_default="none"
        ),
    )
    op.create_check_constraint(
        "ck_memory_items_enrichment_status",
        "memory_items",
        "enrichment_status IN ('none', 'queued', 'ready', 'failed')",
    )
    op.add_column(
        "memory_items",
        sa.Column("enrich_requested_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "memory_items", sa.Column("enriched_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "memory_items", sa.Column("enrichment_model", sa.String(length=128), nullable=True)
    )
    # Daily enrichment cap: requests per user since midnight.
    op.create_index(
        "ix_memory_items_user_enrich_requested",
        "memory_items",
        ["user_id", "enrich_requested_at"],
    )

    op.add_column("memory_chunks", sa.Column("context", sa.Text(), nullable=True))

    op.create_table(
        "memory_questions",
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
        sa.Column(
            "chunk_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("memory_chunks.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("embedding_local", Vector(LOCAL_DIMENSIONS), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_memory_questions_user_id", "memory_questions", ["user_id"])
    op.create_index("ix_memory_questions_memory_id", "memory_questions", ["memory_id"])
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_memory_questions_embedding_local_hnsw "
        "ON memory_questions USING hnsw (embedding_local vector_cosine_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_memory_questions_embedding_local_hnsw")
    op.drop_index("ix_memory_questions_memory_id", table_name="memory_questions")
    op.drop_index("ix_memory_questions_user_id", table_name="memory_questions")
    op.drop_table("memory_questions")
    op.drop_column("memory_chunks", "context")
    op.drop_index("ix_memory_items_user_enrich_requested", table_name="memory_items")
    op.drop_column("memory_items", "enrichment_model")
    op.drop_column("memory_items", "enriched_at")
    op.drop_column("memory_items", "enrich_requested_at")
    op.drop_constraint("ck_memory_items_enrichment_status", "memory_items", type_="check")
    op.drop_column("memory_items", "enrichment_status")
    op.drop_column("memory_items", "key_points")

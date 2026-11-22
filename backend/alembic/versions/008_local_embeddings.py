"""S3 local embeddings: memory_chunks.embedding_local + HNSW cosine index

The column size is fixed here (768, nomic-embed-text-v1.5, chosen by the S3
eval) rather than read
from settings, so a migration always builds the same schema. The 1536-dim
``embedding`` column stays until S10 so going back to a remote provider is a
setting.

Revision ID: 008_local_embeddings
Revises: 007_usage_and_feedback
Create Date: 2026-11-21 12:00:00.000000
"""

from collections.abc import Sequence

import alembic.op as op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector

revision: str = "008_local_embeddings"
down_revision: str | None = "007_usage_and_feedback"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

LOCAL_DIMENSIONS = 768


def upgrade() -> None:
    op.add_column(
        "memory_chunks",
        sa.Column("embedding_local", Vector(LOCAL_DIMENSIONS), nullable=True),
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_memory_chunks_embedding_local_hnsw "
        "ON memory_chunks USING hnsw (embedding_local vector_cosine_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_memory_chunks_embedding_local_hnsw")
    op.drop_column("memory_chunks", "embedding_local")

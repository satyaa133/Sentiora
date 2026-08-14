"""pgvector embeddings on memory_chunks

Revision ID: 005_chunk_embeddings
Revises: 004_memory_chunks
Create Date: 2026-08-13 23:40:00.000000
"""

from collections.abc import Sequence

import alembic.op as op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector

revision: str = "005_chunk_embeddings"
down_revision: str | None = "004_memory_chunks"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.add_column("memory_chunks", sa.Column("embedding", Vector(1536), nullable=True))
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_memory_chunks_embedding_hnsw "
        "ON memory_chunks USING hnsw (embedding vector_cosine_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_memory_chunks_embedding_hnsw")
    op.drop_column("memory_chunks", "embedding")
    op.execute("DROP EXTENSION IF EXISTS vector")

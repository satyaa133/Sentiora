"""RAG v2: chunk time ranges, embedding model, full-text vectors

Revision ID: 006_rag_v2_chunks
Revises: cbb1d84cf989
Create Date: 2026-10-28 12:00:00.000000
"""

from collections.abc import Sequence

import alembic.op as op
import sqlalchemy as sa

revision: str = "006_rag_v2_chunks"
down_revision: str | None = "cbb1d84cf989"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("memory_chunks", sa.Column("start_sec", sa.Float(), nullable=True))
    op.add_column("memory_chunks", sa.Column("end_sec", sa.Float(), nullable=True))
    op.add_column(
        "memory_chunks",
        sa.Column("embedding_model", sa.String(length=128), nullable=True),
    )
    op.execute(
        "ALTER TABLE memory_chunks ADD COLUMN content_tsv tsvector GENERATED ALWAYS AS "
        "(setweight(to_tsvector('english', coalesce(heading, '')), 'B') || "
        "setweight(to_tsvector('english', content), 'A')) STORED"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_memory_chunks_content_tsv "
        "ON memory_chunks USING gin (content_tsv)"
    )
    op.execute(
        "ALTER TABLE memory_items ADD COLUMN title_tsv tsvector GENERATED ALWAYS AS "
        "(to_tsvector('english', coalesce(title, ''))) STORED"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_memory_items_title_tsv "
        "ON memory_items USING gin (title_tsv)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_memory_items_title_tsv")
    op.drop_column("memory_items", "title_tsv")
    op.execute("DROP INDEX IF EXISTS ix_memory_chunks_content_tsv")
    op.drop_column("memory_chunks", "content_tsv")
    op.drop_column("memory_chunks", "embedding_model")
    op.drop_column("memory_chunks", "end_sec")
    op.drop_column("memory_chunks", "start_sec")

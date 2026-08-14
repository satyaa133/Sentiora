"""user source preferences and onboarding flag

Revision ID: 003_user_source_preferences
Revises: 002_memory_items
Create Date: 2026-08-13 22:00:00.000000
"""

from collections.abc import Sequence

import alembic.op as op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "003_user_source_preferences"
down_revision: str | None = "002_memory_items"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "user_profiles",
        sa.Column(
            "onboarding_completed",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "user_profiles",
        sa.Column(
            "source_preferences",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )
    # Existing accounts predate onboarding — do not force them through it again.
    op.execute(
        "UPDATE user_profiles SET onboarding_completed = true WHERE onboarding_completed = false"
    )


def downgrade() -> None:
    op.drop_column("user_profiles", "source_preferences")
    op.drop_column("user_profiles", "onboarding_completed")

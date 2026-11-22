"""S7 privacy notice at sign-up (D10): accepted notice version and time

Revision ID: 010_privacy_consent
Revises: 009_enrichment
Create Date: 2026-11-22 20:00:00.000000
"""

from collections.abc import Sequence

import alembic.op as op
import sqlalchemy as sa

revision: str = "010_privacy_consent"
down_revision: str | None = "009_enrichment"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Existing accounts start without consent: they see the notice before
    # their next AI request. Instant answers and search never need it.
    op.add_column("users", sa.Column("privacy_consent_version", sa.Text(), nullable=True))
    op.add_column(
        "users",
        sa.Column("privacy_consented_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "privacy_consented_at")
    op.drop_column("users", "privacy_consent_version")

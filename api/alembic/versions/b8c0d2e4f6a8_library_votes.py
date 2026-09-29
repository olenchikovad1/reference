"""library votes

«Нравится» и «не нравится» у принтов и надписей (US-0715).

Revision ID: b8c0d2e4f6a8
Revises: a7b9c1d3e5f7
Create Date: 2026-09-29 21:00:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b8c0d2e4f6a8"
down_revision: str | None = "a7b9c1d3e5f7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "library_votes",
        sa.Column("kind", sa.String(8), primary_key=True),
        sa.Column("key", sa.String(1024), primary_key=True),
        sa.Column("voter_id", sa.String(64), primary_key=True),
        sa.Column("value", sa.Integer, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("kind in ('image', 'text')", name="ck_library_votes_kind"),
        sa.CheckConstraint("value in (-1, 1)", name="ck_library_votes_value"),
    )


def downgrade() -> None:
    op.drop_table("library_votes")

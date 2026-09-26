"""reference positions

Личный порядок витрины (US-0601): место карточки у человека. Удаление
карточки уносит её места каскадом.

Revision ID: a4b8c0d2e3f5
Revises: f3a7b9c1d2e4
Create Date: 2026-09-26 09:40:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a4b8c0d2e3f5"
down_revision: str | None = "f3a7b9c1d2e4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "reference_positions",
        sa.Column("author_id", sa.String(64), primary_key=True),
        sa.Column(
            "reference_id", sa.Integer, sa.ForeignKey("reference_cards.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("position", sa.Integer, nullable=False),
    )


def downgrade() -> None:
    op.drop_table("reference_positions")

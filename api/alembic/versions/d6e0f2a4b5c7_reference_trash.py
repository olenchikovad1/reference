"""reference trash

Корзина референсов (US-0494, решение 0014): когда и кем положен. Пусто —
живой.

Revision ID: d6e0f2a4b5c7
Revises: c5d9e1f3a4b6
Create Date: 2026-09-25 15:05:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d6e0f2a4b5c7"
down_revision: str | None = "c5d9e1f3a4b6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("reference_cards", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("reference_cards", sa.Column("deleted_by", sa.String(64), nullable=True))


def downgrade() -> None:
    op.drop_column("reference_cards", "deleted_by")
    op.drop_column("reference_cards", "deleted_at")

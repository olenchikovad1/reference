"""reference rejected

Состояние «забракован» (план 094): конечное, вернуть в работу может главный.

Revision ID: d4e6f8a0b2c3
Revises: c3d5e7f9a1b2
Create Date: 2026-09-29 16:00:00
"""
from collections.abc import Sequence

from alembic import op

revision: str = "d4e6f8a0b2c3"
down_revision: str | None = "c3d5e7f9a1b2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("ck_reference_cards_status", "reference_cards", type_="check")
    op.create_check_constraint("ck_reference_cards_status", "reference_cards",
                               "status in ('draft','review','rework','approved','final','rejected')")


def downgrade() -> None:
    op.drop_constraint("ck_reference_cards_status", "reference_cards", type_="check")
    op.create_check_constraint("ck_reference_cards_status", "reference_cards",
                               "status in ('draft','review','rework','approved','final')")

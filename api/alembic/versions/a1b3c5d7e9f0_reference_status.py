"""reference status

Статус согласования у карточки и путь переходов (US-0510).

Revision ID: a1b3c5d7e9f0
Revises: f9a3b5c7d8e0
Create Date: 2026-09-28 20:30:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a1b3c5d7e9f0"
down_revision: str | None = "f9a3b5c7d8e0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

STATUSES = "('draft','review','rework','approved','final')"


def upgrade() -> None:
    op.add_column("reference_cards", sa.Column("status", sa.String(16), nullable=False, server_default="draft"))
    op.create_check_constraint("ck_reference_cards_status", "reference_cards", f"status in {STATUSES}")
    op.create_table(
        "reference_status_events",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("reference_id", sa.Integer, sa.ForeignKey("reference_cards.id", ondelete="CASCADE"), nullable=False),
        sa.Column("from_status", sa.String(16), nullable=False),
        sa.Column("to_status", sa.String(16), nullable=False),
        sa.Column("number", sa.Integer, nullable=False),
        sa.Column("by_id", sa.String(64), nullable=True),
        sa.Column("comment", sa.String(2000), nullable=True),
        sa.Column("at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_reference_status_events_reference", "reference_status_events", ["reference_id"])


def downgrade() -> None:
    op.drop_index("ix_reference_status_events_reference", table_name="reference_status_events")
    op.drop_table("reference_status_events")
    op.drop_constraint("ck_reference_cards_status", "reference_cards", type_="check")
    op.drop_column("reference_cards", "status")

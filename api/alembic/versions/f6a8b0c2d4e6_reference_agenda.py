"""reference agenda

Выдвинуть на обсуждение и встречи по согласованию (план 097).

Revision ID: f6a8b0c2d4e6
Revises: e5f7a9b1c3d4
Create Date: 2026-09-29 18:00:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f6a8b0c2d4e6"
down_revision: str | None = "e5f7a9b1c3d4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "reference_meetings",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("held_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("by_id", sa.String(64), nullable=True),
    )
    op.create_table(
        "reference_agenda_items",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("reference_id", sa.Integer, sa.ForeignKey("reference_cards.id", ondelete="CASCADE"), nullable=False),
        sa.Column("reason", sa.String(2000), nullable=False),
        sa.Column("by_id", sa.String(64), nullable=True),
        sa.Column("at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("meeting_id", sa.Integer, sa.ForeignKey("reference_meetings.id"), nullable=True),
        sa.Column("removed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("removed_by", sa.String(64), nullable=True),
    )
    # Повестка — открытые: по ним ищут на каждой витрине.
    op.create_index("reference_agenda_open", "reference_agenda_items", ["reference_id"],
                    postgresql_where=sa.text("meeting_id IS NULL AND removed_at IS NULL"))


def downgrade() -> None:
    op.drop_index("reference_agenda_open", "reference_agenda_items")
    op.drop_table("reference_agenda_items")
    op.drop_table("reference_meetings")

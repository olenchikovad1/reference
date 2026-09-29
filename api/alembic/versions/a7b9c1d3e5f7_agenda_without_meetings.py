"""agenda without meetings

Встреч в приложении нет (план 098, владелец 29.09: «встречи проходят в
телемосте»): повод уходит с повестки решением или вручную.

Revision ID: a7b9c1d3e5f7
Revises: f6a8b0c2d4e6
Create Date: 2026-09-29 19:00:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a7b9c1d3e5f7"
down_revision: str | None = "f6a8b0c2d4e6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("reference_agenda_items", sa.Column("resolution", sa.String(16), nullable=True))
    # Обсуждённое на «встречах» плана 097 — закрыто вручную тем же моментом.
    op.execute("""
        update reference_agenda_items i set removed_at = m.held_at, removed_by = m.by_id, resolution = 'manual'
        from reference_meetings m where i.meeting_id = m.id and i.removed_at is null
    """)
    op.drop_index("reference_agenda_open", "reference_agenda_items")
    op.drop_column("reference_agenda_items", "meeting_id")
    op.drop_table("reference_meetings")
    op.create_index("reference_agenda_open", "reference_agenda_items", ["reference_id"],
                    postgresql_where=sa.text("removed_at IS NULL"))


def downgrade() -> None:
    op.drop_index("reference_agenda_open", "reference_agenda_items")
    op.create_table(
        "reference_meetings",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("held_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("by_id", sa.String(64), nullable=True),
    )
    op.add_column("reference_agenda_items",
                  sa.Column("meeting_id", sa.Integer, sa.ForeignKey("reference_meetings.id"), nullable=True))
    op.drop_column("reference_agenda_items", "resolution")
    op.create_index("reference_agenda_open", "reference_agenda_items", ["reference_id"],
                    postgresql_where=sa.text("meeting_id IS NULL AND removed_at IS NULL"))

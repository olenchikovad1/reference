"""remark voice

Голос у замечания: аудио, расшифровка как услышано, состояние расшифровки
(US-0512, решение 0017).

Revision ID: c3d5e7f9a1b2
Revises: b2c4d6e8f0a1
Create Date: 2026-09-28 22:30:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c3d5e7f9a1b2"
down_revision: str | None = "b2c4d6e8f0a1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("reference_remarks", sa.Column("audio_digest", sa.String(64), nullable=True))
    op.add_column("reference_remarks", sa.Column("audio_type", sa.String(64), nullable=True))
    op.add_column("reference_remarks", sa.Column("audio_seconds", sa.Float, nullable=True))
    op.add_column("reference_remarks", sa.Column("heard", sa.String(2000), nullable=True))
    op.add_column("reference_remarks", sa.Column("voice_status", sa.String(16), nullable=True))
    op.add_column("reference_remarks", sa.Column("voice_error", sa.String(500), nullable=True))
    op.add_column("reference_remarks",
                  sa.Column("voice_attempts", sa.Integer, nullable=False, server_default="0"))
    op.create_check_constraint(
        "reference_remarks_voice_status", "reference_remarks",
        "voice_status IS NULL OR voice_status IN ('pending', 'working', 'done', 'failed')")
    # Очередь при старте ищет недошедшие — по состоянию, а не перебором.
    op.create_index("reference_remarks_voice_waiting", "reference_remarks", ["voice_status"],
                    postgresql_where=sa.text("voice_status IN ('pending', 'working')"))


def downgrade() -> None:
    op.drop_index("reference_remarks_voice_waiting", "reference_remarks")
    op.drop_constraint("reference_remarks_voice_status", "reference_remarks")
    for c in ("voice_attempts", "voice_error", "voice_status", "heard", "audio_seconds", "audio_type", "audio_digest"):
        op.drop_column("reference_remarks", c)

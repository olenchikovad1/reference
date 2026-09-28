"""retag runs

Переразметка библиотеки в фоне (US-0629): запуск, ход, неудачи с причиной и
итог «было и стало». Строка на запуск: ход виден, прерванный продолжается —
что осталось, считается заново по устаревшим картинкам.

Revision ID: e8f2a4b6c7d9
Revises: c6d0e2f4a5b7
Create Date: 2026-09-28 16:00:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e8f2a4b6c7d9"
down_revision: str | None = "c6d0e2f4a5b7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "retag_runs",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_by", sa.String(64), nullable=True),
        sa.Column("total", sa.Integer, nullable=False),
        sa.Column("done", sa.Integer, nullable=False, server_default="0"),
        sa.Column("failed", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column("before", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("after", postgresql.JSONB, nullable=True),
        sa.CheckConstraint("done >= 0 and total >= 0", name="ck_retag_runs_counts"),
    )


def downgrade() -> None:
    op.drop_table("retag_runs")

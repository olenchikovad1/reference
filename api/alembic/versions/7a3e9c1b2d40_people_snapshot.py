"""people snapshot

Снимок людей приложения из платформы и последние известные имена субъектов
(план 072, US-0508). Не таблица пользователей: только проекция для показа.

Revision ID: 7a3e9c1b2d40
Revises: 5f1c2a7d9e10
Create Date: 2026-09-25 10:20:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "7a3e9c1b2d40"
down_revision: str | None = "5f1c2a7d9e10"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "people",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("display_name", sa.String(length=300), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("organization_id", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("right_sets", postgresql.ARRAY(sa.String(length=64)), nullable=False, server_default="{}"),
    )
    op.create_table(
        "subject_names",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("display_name", sa.String(length=300), nullable=False),
        sa.Column("seen_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("subject_names")
    op.drop_table("people")

"""version auto reason

Версия, сделанная сама перед переходом (US-0599): перед каким — «перед
выгрузкой листа». Пусто — сохранил человек. Столбец новый и пустой у всех
прежних версий: они сохранены руками.

Revision ID: f3a7b9c1d2e4
Revises: e2f6a8b0c1d3
Create Date: 2026-09-26 08:10:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f3a7b9c1d2e4"
down_revision: str | None = "e2f6a8b0c1d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("reference_versions", sa.Column("auto_reason", sa.String(120), nullable=True))


def downgrade() -> None:
    op.drop_column("reference_versions", "auto_reason")

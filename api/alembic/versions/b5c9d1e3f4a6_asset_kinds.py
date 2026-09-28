"""asset kinds

Вид картинки (US-0625): аниме, иллюстрация, плоская графика, надпись, фото —
решение маршрутизатора и поправка рукой рядом. Строка на файл, как у
названия: вид — свойство картинки, а не референса.

Revision ID: b5c9d1e3f4a6
Revises: a4b8c0d2e3f5
Create Date: 2026-09-28 11:00:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b5c9d1e3f4a6"
down_revision: str | None = "a4b8c0d2e3f5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

KINDS = "('anime','illustration','flat','text','photo')"


def upgrade() -> None:
    op.create_table(
        "asset_kinds",
        sa.Column("digest", sa.String(64), primary_key=True),
        sa.Column("model", sa.String(128), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("second", sa.String(16), nullable=True),
        sa.Column("gap", sa.Float, nullable=False),
        sa.Column("manual", sa.String(16), nullable=True),
        sa.Column("manual_by", sa.String(64), nullable=True),
        sa.Column("manual_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(f"kind in {KINDS}", name="ck_asset_kinds_kind"),
        sa.CheckConstraint(f"second is null or second in {KINDS}", name="ck_asset_kinds_second"),
        sa.CheckConstraint(f"manual is null or manual in {KINDS}", name="ck_asset_kinds_manual"),
    )


def downgrade() -> None:
    op.drop_table("asset_kinds")

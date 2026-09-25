"""asset defects

Брак картинки с причиной (US-0499): картинка остаётся в библиотеке, но не
показывается и в референс не кладётся. Причина обязательна — это держит база.

Revision ID: c1d5e7f9a0b2
Revises: b0c4d6e8f9a1
Create Date: 2026-09-25 18:50:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c1d5e7f9a0b2"
down_revision: str | None = "b0c4d6e8f9a1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "asset_defects",
        sa.Column("digest", sa.String(64), primary_key=True),
        sa.Column("reason", sa.String(500), nullable=False),
        sa.Column("marked_by", sa.String(64), nullable=True),
        sa.Column("marked_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("trim(reason) <> ''", name="ck_asset_defects_reason"),
    )


def downgrade() -> None:
    op.drop_table("asset_defects")

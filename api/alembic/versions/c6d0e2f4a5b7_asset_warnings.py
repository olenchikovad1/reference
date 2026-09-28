"""asset warnings

Предупреждения разметчика (US-0626): чужой персонаж и взрослое. С моделью,
как теги: пересчитываются вместе с ними.

Revision ID: c6d0e2f4a5b7
Revises: b5c9d1e3f4a6
Create Date: 2026-09-28 12:30:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c6d0e2f4a5b7"
down_revision: str | None = "b5c9d1e3f4a6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "asset_warnings",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("digest", sa.String(64), nullable=False),
        sa.Column("model", sa.String(128), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("code", sa.String(256), nullable=False),
        sa.Column("text", sa.String(512), nullable=False),
        sa.CheckConstraint("kind in ('character','adult')", name="ck_asset_warnings_kind"),
    )
    op.create_index("ix_asset_warnings_digest", "asset_warnings", ["digest"])


def downgrade() -> None:
    op.drop_index("ix_asset_warnings_digest", table_name="asset_warnings")
    op.drop_table("asset_warnings")

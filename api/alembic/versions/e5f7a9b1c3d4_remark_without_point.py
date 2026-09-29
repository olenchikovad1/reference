"""remark without point

Замечание без точки на изделии (план 095): сторона и доли кадра — по желанию.

Revision ID: e5f7a9b1c3d4
Revises: d4e6f8a0b2c3
Create Date: 2026-09-29 17:00:00
"""
from collections.abc import Sequence

from alembic import op

revision: str = "e5f7a9b1c3d4"
down_revision: str | None = "d4e6f8a0b2c3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for c in ("side", "x", "y"):
        op.alter_column("reference_remarks", c, nullable=True)


def downgrade() -> None:
    op.execute("delete from reference_remarks where side is null or x is null or y is null")
    for c in ("side", "x", "y"):
        op.alter_column("reference_remarks", c, nullable=False)

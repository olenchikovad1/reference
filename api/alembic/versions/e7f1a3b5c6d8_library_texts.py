"""library texts

Надписи, заведённые заранее, до референса (US-0496).

Revision ID: e7f1a3b5c6d8
Revises: d6e0f2a4b5c7
Create Date: 2026-09-25 15:40:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e7f1a3b5c6d8"
down_revision: str | None = "d6e0f2a4b5c7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "library_texts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("text", sa.String(1024), nullable=False),
        sa.Column("normalised", sa.String(1024), nullable=False, unique=True),
        sa.Column("author_id", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("library_texts")

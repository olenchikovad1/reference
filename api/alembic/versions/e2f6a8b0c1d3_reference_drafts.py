"""reference drafts

Черновик между версиями (US-0598): строка на карточку и человека, у новой
работы карточки нет — одна строка на человека. Удаление карточки уносит её
черновики каскадом.

Revision ID: e2f6a8b0c1d3
Revises: c1d5e7f9a0b2
Create Date: 2026-09-26 07:30:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e2f6a8b0c1d3"
down_revision: str | None = "c1d5e7f9a0b2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "reference_drafts",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("reference_id", sa.Integer, sa.ForeignKey("reference_cards.id", ondelete="CASCADE"), nullable=True),
        sa.Column("author_id", sa.String(64), nullable=False),
        sa.Column("base_number", sa.Integer, nullable=True),
        sa.Column("work", postgresql.JSONB, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(
        "uq_reference_drafts_card_author", "reference_drafts", ["reference_id", "author_id"],
        unique=True, postgresql_where=sa.text("reference_id IS NOT NULL"),
    )
    op.create_index(
        "uq_reference_drafts_new_author", "reference_drafts", ["author_id"],
        unique=True, postgresql_where=sa.text("reference_id IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_reference_drafts_new_author", table_name="reference_drafts")
    op.drop_index("uq_reference_drafts_card_author", table_name="reference_drafts")
    op.drop_table("reference_drafts")

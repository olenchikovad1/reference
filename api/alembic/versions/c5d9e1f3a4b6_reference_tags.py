"""reference tags

Свои теги референса и скрытые у него автотеги (US-0493). Триграммный индекс
на своих тегах — по той же причине, что у надписей (решение 0010): поиск по
«школьн» и по другой форме слова без перебора всей таблицы.

Revision ID: c5d9e1f3a4b6
Revises: b4c8d0e2f3a5
Create Date: 2026-09-25 14:20:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c5d9e1f3a4b6"
down_revision: str | None = "b4c8d0e2f3a5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "reference_tags",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("reference_id", sa.Integer(),
                  sa.ForeignKey("reference_cards.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("normalised", sa.String(120), nullable=False),
        sa.Column("author_id", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("reference_id", "normalised", name="uq_reference_tag"),
    )
    op.create_index("ix_reference_tags_trgm", "reference_tags", ["normalised"],
                    postgresql_using="gin", postgresql_ops={"normalised": "gin_trgm_ops"})
    op.create_table(
        "reference_hidden_tags",
        sa.Column("reference_id", sa.Integer(),
                  sa.ForeignKey("reference_cards.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("code", sa.String(120), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("reference_hidden_tags")
    op.drop_index("ix_reference_tags_trgm", table_name="reference_tags")
    op.drop_table("reference_tags")

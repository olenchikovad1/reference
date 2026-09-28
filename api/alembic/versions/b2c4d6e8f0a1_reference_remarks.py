"""reference remarks

Замечания на слое или месте изделия, на версии, с веткой сообщений (US-0511).

Revision ID: b2c4d6e8f0a1
Revises: a1b3c5d7e9f0
Create Date: 2026-09-28 21:30:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b2c4d6e8f0a1"
down_revision: str | None = "a1b3c5d7e9f0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "reference_remarks",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("reference_id", sa.Integer, sa.ForeignKey("reference_cards.id", ondelete="CASCADE"), nullable=False),
        sa.Column("number", sa.Integer, nullable=False),
        sa.Column("side", sa.String(32), nullable=False),
        sa.Column("element_id", sa.String(64), nullable=True),
        sa.Column("element_name", sa.String(300), nullable=True),
        sa.Column("x", sa.Float, nullable=False),
        sa.Column("y", sa.Float, nullable=False),
        sa.Column("text", sa.String(2000), nullable=False),
        sa.Column("author_id", sa.String(64), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="open"),
        sa.Column("fixed_in", sa.Integer, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("status in ('open','fixed','accepted')", name="ck_reference_remarks_status"),
        sa.CheckConstraint("x >= 0 and x <= 1 and y >= 0 and y <= 1", name="ck_reference_remarks_point"),
    )
    op.create_index("ix_reference_remarks_reference", "reference_remarks", ["reference_id"])
    op.create_table(
        "reference_remark_messages",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("remark_id", sa.Integer, sa.ForeignKey("reference_remarks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("text", sa.String(2000), nullable=True),
        sa.Column("author_id", sa.String(64), nullable=True),
        sa.Column("number", sa.Integer, nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("kind in ('reply','fixed','accepted','rejected')", name="ck_reference_remark_messages_kind"),
    )
    op.create_index("ix_reference_remark_messages_remark", "reference_remark_messages", ["remark_id"])


def downgrade() -> None:
    op.drop_index("ix_reference_remark_messages_remark", table_name="reference_remark_messages")
    op.drop_table("reference_remark_messages")
    op.drop_index("ix_reference_remarks_reference", table_name="reference_remarks")
    op.drop_table("reference_remarks")

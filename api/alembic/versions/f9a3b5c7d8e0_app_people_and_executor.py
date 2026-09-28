"""app people and executor

Роли в согласовании и ФИО — своя таблица (решение 0016); исполнитель у
референса и история передач (US-0509). У живых референсов исполнитель —
автор первой версии: это и есть «по умолчанию тот, кто создал».

Revision ID: f9a3b5c7d8e0
Revises: e8f2a4b6c7d9
Create Date: 2026-09-28 19:00:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f9a3b5c7d8e0"
down_revision: str | None = "e8f2a4b6c7d9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "app_people",
        sa.Column("subject_id", sa.String(64), primary_key=True),
        sa.Column("full_name", sa.String(200), nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("updated_by", sa.String(64), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("role in ('designer','editor','chief')", name="ck_app_people_role"),
        sa.CheckConstraint("length(trim(full_name)) > 0", name="ck_app_people_full_name"),
    )
    op.add_column("reference_cards", sa.Column("executor_id", sa.String(64), nullable=True))
    op.execute(
        "update reference_cards c set executor_id = v.author_id from reference_versions v "
        "where v.reference_id = c.id and v.number = 1"
    )
    op.create_table(
        "reference_transfers",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("reference_id", sa.Integer, sa.ForeignKey("reference_cards.id", ondelete="CASCADE"), nullable=False),
        sa.Column("from_id", sa.String(64), nullable=True),
        sa.Column("to_id", sa.String(64), nullable=False),
        sa.Column("by_id", sa.String(64), nullable=True),
        sa.Column("at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_reference_transfers_reference", "reference_transfers", ["reference_id"])


def downgrade() -> None:
    op.drop_index("ix_reference_transfers_reference", table_name="reference_transfers")
    op.drop_table("reference_transfers")
    op.drop_column("reference_cards", "executor_id")
    op.drop_table("app_people")

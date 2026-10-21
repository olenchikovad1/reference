"""Разработка коллекции: вариант — карточка референса на базе, метки, место и «Отложено» (решение 0020).

Revision ID: c7e1a9d3f5b8
Revises: b3c5d7e9f0a2
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c7e1a9d3f5b8"
down_revision: str | None = "b3c5d7e9f0a2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

#: Стартовые метки из спеки PLM 2026-10-21-collection-design-board; дальше их
#: правят люди — справочником, не миграцией.
STARTING_LABELS = (
    ("Смотреть директору", "amber"),
    ("Правки директора", "rose"),
    ("Согласовано директором", "green"),
    ("Готово — отдано фабрике", "blue"),
)


def upgrade() -> None:
    labels = op.create_table(
        "collection_labels",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("tone", sa.String(16), nullable=False, server_default="slate"),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("name", name="uq_collection_label_name"),
    )
    op.bulk_insert(
        labels,
        [{"name": name, "tone": tone, "position": i} for i, (name, tone) in enumerate(STARTING_LABELS)],
    )

    op.add_column("reference_cards", sa.Column("plm_release_id", sa.String(64), nullable=True))
    op.add_column("reference_cards", sa.Column("plm_style_id", sa.String(64), nullable=True))
    op.add_column("reference_cards", sa.Column("plm_colorway_id", sa.String(64), nullable=True))
    op.add_column(
        "reference_cards",
        sa.Column(
            "label_id", sa.Integer(), sa.ForeignKey("collection_labels.id", ondelete="RESTRICT"), nullable=True
        ),
    )
    op.add_column("reference_cards", sa.Column("board_position", sa.Integer(), nullable=True))
    op.add_column("reference_cards", sa.Column("shelved_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("reference_cards", sa.Column("shelved_by", sa.String(64), nullable=True))
    op.create_check_constraint(
        "ck_reference_collection_keys",
        "reference_cards",
        "(plm_release_id is null) = (plm_style_id is null) and (plm_colorway_id is null or plm_style_id is not null)",
    )
    op.create_index("ix_reference_cards_plm_release", "reference_cards", ["plm_release_id"])

    op.create_table(
        "reference_label_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "reference_id", sa.Integer(), sa.ForeignKey("reference_cards.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "label_id", sa.Integer(), sa.ForeignKey("collection_labels.id", ondelete="RESTRICT"), nullable=True
        ),
        sa.Column("by_id", sa.String(64), nullable=True),
        sa.Column("at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_reference_label_events_reference", "reference_label_events", ["reference_id"])

    op.create_table(
        "reference_seen",
        sa.Column(
            "reference_id", sa.Integer(), sa.ForeignKey("reference_cards.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("viewer_id", sa.String(64), primary_key=True),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("reference_seen")
    op.drop_index("ix_reference_label_events_reference", table_name="reference_label_events")
    op.drop_table("reference_label_events")
    op.drop_index("ix_reference_cards_plm_release", table_name="reference_cards")
    op.drop_constraint("ck_reference_collection_keys", "reference_cards", type_="check")
    op.drop_column("reference_cards", "shelved_by")
    op.drop_column("reference_cards", "shelved_at")
    op.drop_column("reference_cards", "board_position")
    op.drop_column("reference_cards", "label_id")
    op.drop_column("reference_cards", "plm_colorway_id")
    op.drop_column("reference_cards", "plm_style_id")
    op.drop_column("reference_cards", "plm_release_id")
    op.drop_table("collection_labels")

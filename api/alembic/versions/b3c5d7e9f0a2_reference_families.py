"""Семейство: модель+дроп на карточке, исключения цветов (US-0890, решение 0019).

Revision ID: b3c5d7e9f0a2
Revises: a2c4e6f8b0d1
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b3c5d7e9f0a2"
down_revision: str | None = "a2c4e6f8b0d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "reference_cards",
        sa.Column("garment_model_id", sa.Integer(), sa.ForeignKey("garment_models.id", ondelete="RESTRICT"), nullable=True),
    )
    op.add_column(
        "reference_cards",
        sa.Column("drop_id", sa.Integer(), sa.ForeignKey("drops.id", ondelete="RESTRICT"), nullable=True),
    )
    op.create_table(
        "reference_colour_exclusions",
        sa.Column("reference_id", sa.Integer(), sa.ForeignKey("reference_cards.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("colour_model_id", sa.Integer(), sa.ForeignKey("colour_models.id", ondelete="CASCADE"), primary_key=True),
    )
    # Старые карточки: семья из одного цвета — основной остаётся, остальные
    # цвета модели в её дропах в исключениях, чтобы витрина не раздулась.
    op.execute(
        """
        update reference_cards c
        set garment_model_id = cm.model_id
        from colour_models cm
        where c.colour_model_id = cm.id and c.garment_model_id is null
        """
    )
    op.execute(
        """
        update reference_cards c
        set drop_id = (
            select di.drop_id from drop_items di
            where di.colour_model_id = c.colour_model_id
            order by di.drop_id limit 1
        )
        where c.colour_model_id is not null and c.drop_id is null
        """
    )
    op.execute(
        """
        insert into reference_colour_exclusions (reference_id, colour_model_id)
        select c.id, other.id
        from reference_cards c
        join colour_models mine on mine.id = c.colour_model_id
        join colour_models other on other.model_id = mine.model_id and other.id <> mine.id
        join drop_items di on di.colour_model_id = other.id and di.drop_id = c.drop_id
        where c.drop_id is not null
        on conflict do nothing
        """
    )


def downgrade() -> None:
    op.drop_table("reference_colour_exclusions")
    op.drop_column("reference_cards", "drop_id")
    op.drop_column("reference_cards", "garment_model_id")

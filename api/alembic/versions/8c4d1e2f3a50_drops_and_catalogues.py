"""drops and catalogues

Дропы, ассортимент, товарная иерархия, модели и цветомодели (план 073,
US-0489); у карточки референса — цветомодель. Справочники свои (решение 0013).

Revision ID: 8c4d1e2f3a50
Revises: 7a3e9c1b2d40
Create Date: 2026-09-25 11:10:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "8c4d1e2f3a50"
down_revision: str | None = "7a3e9c1b2d40"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "hierarchy_nodes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("parent_id", sa.Integer(), sa.ForeignKey("hierarchy_nodes.id", ondelete="RESTRICT")),
        sa.Column("level", sa.String(16), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.CheckConstraint("level in ('direction', 'gender', 'group', 'category')", name="ck_hierarchy_level"),
        sa.CheckConstraint("(level = 'direction') = (parent_id is null)", name="ck_hierarchy_root"),
        sa.UniqueConstraint("parent_id", "name", name="uq_hierarchy_sibling_name"),
    )
    op.create_table(
        "garment_models",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(64), nullable=False, unique=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("category_id", sa.Integer(), sa.ForeignKey("hierarchy_nodes.id", ondelete="RESTRICT"),
                  nullable=False),
        sa.Column("product_code", sa.String(64)),
    )
    op.create_table(
        "colour_models",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("model_id", sa.Integer(), sa.ForeignKey("garment_models.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("colour_code", sa.String(64), nullable=False),
        sa.UniqueConstraint("model_id", "colour_code", name="uq_colour_model"),
    )
    op.create_table(
        "drops",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False, unique=True),
        sa.Column("season", sa.String(16), nullable=False),
        sa.Column("release_from", sa.Date(), nullable=False),
        sa.Column("release_to", sa.Date(), nullable=False),
        sa.Column("audience", sa.String(120), nullable=False),
        sa.Column("theme", sa.Text(), nullable=False, server_default=""),
        sa.Column("retired", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.CheckConstraint("release_from <= release_to", name="ck_drop_dates"),
    )
    op.create_table(
        "drop_items",
        sa.Column("drop_id", sa.Integer(), sa.ForeignKey("drops.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("colour_model_id", sa.Integer(), sa.ForeignKey("colour_models.id", ondelete="RESTRICT"),
                  primary_key=True),
    )
    op.add_column("reference_cards", sa.Column(
        "colour_model_id", sa.Integer(), sa.ForeignKey("colour_models.id", ondelete="RESTRICT"), nullable=True))


def downgrade() -> None:
    op.drop_column("reference_cards", "colour_model_id")
    op.drop_table("drop_items")
    op.drop_table("drops")
    op.drop_table("colour_models")
    op.drop_table("garment_models")
    op.drop_table("hierarchy_nodes")

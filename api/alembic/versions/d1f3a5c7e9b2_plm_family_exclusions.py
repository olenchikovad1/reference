"""Собственные исключения цветов PLM; каталог не копируется.

Revision ID: d1f3a5c7e9b2
Revises: c7e1a9d3f5b8
"""
from alembic import op
import sqlalchemy as sa

revision = "d1f3a5c7e9b2"
down_revision = "c7e1a9d3f5b8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("reference_plm_colour_exclusions",
                    sa.Column("reference_id", sa.Integer(), sa.ForeignKey("reference_cards.id", ondelete="CASCADE"), primary_key=True),
                    sa.Column("colorway_id", sa.String(64), primary_key=True))


def downgrade() -> None:
    # Удаляются только собственные исключения; версии и исходники не затрагиваются.
    op.drop_table("reference_plm_colour_exclusions")

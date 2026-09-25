"""reference version views

Снимки изделия по сторонам у версии (US-0491): витрина показывает их, а не
рисует изделия на лету. Прежние версии остаются без снимков — изображения их
при сохранении не делались, а дорисовать задним числом значит показать то,
чего при сохранении не было.

Revision ID: b4c8d0e2f3a5
Revises: a3b7c9d1e2f4
Create Date: 2026-09-25 13:10:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "b4c8d0e2f3a5"
down_revision: str | None = "a3b7c9d1e2f4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("reference_versions", sa.Column("views", JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("reference_versions", "views")

"""reference card author

Кто сохранил карточку — id субъекта платформы из токена (план 072, US-0486).
Не внешний ключ: таблицы людей в приложении нет и не будет (И-5). Пустое
значение законно — карточки, сохранённые до входа, и стенд без платформы.

Revision ID: 5f1c2a7d9e10
Revises: 2c0d395ea773
Create Date: 2026-09-25 09:30:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "5f1c2a7d9e10"
down_revision: str | None = "2c0d395ea773"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("reference_cards", sa.Column("author_id", sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column("reference_cards", "author_id")

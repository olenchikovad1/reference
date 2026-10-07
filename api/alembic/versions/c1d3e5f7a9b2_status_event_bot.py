"""status event bot

Ревизия: c1d3e5f7a9b2
Предыдущая: b8c0d2e4f6a8
Создана: 2026-10-07

Недеструктивная: шаг согласования помнит, что его сделал ИИ-помощник от имени
человека (план 119, US-0897). Пусто — шаг сделал сам человек; у всех прежних
переходов пусто, и это правда.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c1d3e5f7a9b2"
down_revision: str | None = "b8c0d2e4f6a8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("reference_status_events", sa.Column("bot_name", sa.String(200), nullable=True))


def downgrade() -> None:
    op.drop_column("reference_status_events", "bot_name")

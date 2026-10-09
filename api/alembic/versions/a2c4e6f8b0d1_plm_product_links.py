"""plm product links

Ревизия: a2c4e6f8b0d1
Предыдущая: c1d3e5f7a9b2
Создана: 2026-10-09

Тонкая связь style_code PLM → product_code кадров (US-0886, решение 0018).
Не зеркало каталога — только ключи.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a2c4e6f8b0d1"
down_revision: str | None = "c1d3e5f7a9b2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "plm_product_links",
        sa.Column("style_code", sa.String(64), primary_key=True),
        sa.Column("product_code", sa.String(64), nullable=False),
    )
    # Стендовая толстовка: артикул PLM совпадает с кодом изделия, пока технолог
    # не заведёт иные соответствия. Без строки can_work для этой модели ложен.
    op.execute(
        "INSERT INTO plm_product_links (style_code, product_code) VALUES "
        "('B-HDY-14', 'B-HDY-14'),"
        "('2027', 'B-HDY-14')"
    )


def downgrade() -> None:
    op.drop_table("plm_product_links")

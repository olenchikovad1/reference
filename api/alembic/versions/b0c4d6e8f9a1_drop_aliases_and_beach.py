"""drop aliases and beach collection

Поиск по смыслу (US-0498): у дропа — «как его ещё называют». И дроп, на
котором держится демонстрация «лето»: «Пляжная коллекция 2027» — слова «лето»
нет ни в названии, ни в теме, найти его можно только по смыслу и по месяцам
выхода. Худи стенда в белом входит в его ассортимент.

Revision ID: b0c4d6e8f9a1
Revises: a9b3c5d7e8f0
Create Date: 2026-09-25 18:10:00
"""
from collections.abc import Sequence
from datetime import date

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY

revision: str = "b0c4d6e8f9a1"
down_revision: str | None = "a9b3c5d7e8f0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

BEACH = 6
#: Цветомодель худи стенда в белом (сид 9d5e2f3a4b61).
HOODIE_WHITE = 2


def upgrade() -> None:
    op.add_column("drops", sa.Column("aliases", ARRAY(sa.String(120)), nullable=False, server_default="{}"))
    op.execute("update drops set aliases = '{новогодний}' where name = 'Новый год 2027'")
    op.execute("update drops set aliases = '{День защитника Отечества}' where name = '23 февраля 2027'")
    drops = sa.table("drops", sa.column("id"), sa.column("name"), sa.column("season"), sa.column("release_from"),
                     sa.column("release_to"), sa.column("audience"), sa.column("theme"), sa.column("retired"))
    op.bulk_insert(drops, [{
        "id": BEACH, "name": "Пляжная коллекция 2027", "season": "SS27", "release_from": date(2027, 6, 1),
        "release_to": date(2027, 7, 31), "audience": "дети", "theme": "море, песок, солнце, волны", "retired": False,
    }])
    op.execute("select setval(pg_get_serial_sequence('drops', 'id'), (select max(id) from drops))")
    items = sa.table("drop_items", sa.column("drop_id"), sa.column("colour_model_id"))
    op.bulk_insert(items, [{"drop_id": BEACH, "colour_model_id": HOODIE_WHITE}])


def downgrade() -> None:
    op.execute(f"delete from drop_items where drop_id = {BEACH}")
    op.execute(f"delete from drops where id = {BEACH}")
    op.drop_column("drops", "aliases")

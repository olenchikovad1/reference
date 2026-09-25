"""catalogues seed

Справочники заполнены сразу (US-0489, «сразу заведи немного, чем-нибудь»):
иерархия, четыре модели разных видов, цветомодели, пять дропов. Кадры есть
только у худи стенда B-HDY-14 — остальные модели без изделия, чтобы иерархия и
матрица были не из одной строки. B-HDY-14 девичья (размерный ряд «98–164
Девочки»), поэтому стоит под «Девочки»; мальчиков представляют другие модели.

Revision ID: 9d5e2f3a4b61
Revises: 8c4d1e2f3a50
Create Date: 2026-09-25 11:12:00
"""
from collections.abc import Sequence
from datetime import date

import sqlalchemy as sa
from alembic import op

revision: str = "9d5e2f3a4b61"
down_revision: str | None = "8c4d1e2f3a50"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NODES = [
    (1, None, "direction", "Детское"), (2, 1, "gender", "Девочки"), (3, 1, "gender", "Мальчики"),
    (4, 2, "group", "Трикотаж"), (5, 3, "group", "Трикотаж"),
    (6, 4, "category", "Худи"), (7, 4, "category", "Свитшоты"), (8, 5, "category", "Худи"),
    (9, 5, "category", "Футболки"),
]
MODELS = [
    (1, "B-HDY-14", "Толстовка на молнии, капюшон", 6, "B-HDY-14"),
    (2, "G-SWT-03", "Свитшот базовый", 7, None),
    (3, "B-HDP-02", "Худи без молнии", 8, None),
    (4, "B-TSH-07", "Футболка оверсайз", 9, None),
]
COLOURS = [
    (1, 1, "BLACK"), (2, 1, "WHITE"), (3, 1, "18-1756 TPG"), (4, 1, "RED"),
    (5, 2, "WHITE"), (6, 2, "VIOLET"),
    (7, 3, "BLACK"), (8, 3, "16-0518 TPG"),
    (9, 4, "WHITE"), (10, 4, "19-4057 TPG"),
]
DROPS = [
    (1, "Зима 2026/27", "AW26", date(2026, 11, 2), date(2026, 12, 20), "девочки 98–164", "зима, снег, уют", False),
    (2, "Новый год 2027", "AW26", date(2026, 12, 1), date(2026, 12, 28), "дети", "ёлка, гирлянды, подарки", False),
    (3, "23 февраля 2027", "SS27", date(2027, 2, 8), date(2027, 2, 23), "мальчики", "военная техника, танки", False),
    (4, "Весна 2027", "SS27", date(2027, 3, 15), date(2027, 4, 30), "дети", "цветы, птицы", False),
    (5, "Лето 2026", "SS26", date(2026, 5, 15), date(2026, 6, 30), "дети", "пляж, море", True),
]
ITEMS = [(1, 1), (1, 2), (1, 3), (1, 5), (1, 6), (2, 1), (2, 4), (2, 9), (3, 7), (3, 8), (3, 10),
         (4, 2), (4, 6), (5, 9), (5, 10)]


def upgrade() -> None:
    t, c = sa.table, sa.column
    op.bulk_insert(t("hierarchy_nodes", c("id"), c("parent_id"), c("level"), c("name")),
                   [dict(zip(("id", "parent_id", "level", "name"), n)) for n in NODES])
    op.bulk_insert(t("garment_models", c("id"), c("code"), c("name"), c("category_id"), c("product_code")),
                   [dict(zip(("id", "code", "name", "category_id", "product_code"), m)) for m in MODELS])
    op.bulk_insert(t("colour_models", c("id"), c("model_id"), c("colour_code")),
                   [dict(zip(("id", "model_id", "colour_code"), x)) for x in COLOURS])
    op.bulk_insert(
        t("drops", c("id"), c("name"), c("season"), c("release_from"), c("release_to"), c("audience"),
          c("theme"), c("retired")),
        [dict(zip(("id", "name", "season", "release_from", "release_to", "audience", "theme", "retired"), d))
         for d in DROPS])
    op.bulk_insert(t("drop_items", c("drop_id"), c("colour_model_id")),
                   [{"drop_id": d, "colour_model_id": m} for d, m in ITEMS])
    # Ключи заданы явно — последовательности сдвигаются за них, иначе первая
    # запись, заведённая руками, упрётся в занятый id.
    for table in ("hierarchy_nodes", "garment_models", "colour_models", "drops"):
        op.execute(f"select setval(pg_get_serial_sequence('{table}', 'id'), (select max(id) from {table}))")


def downgrade() -> None:
    op.execute("delete from drop_items where drop_id between 1 and 5")
    op.execute("delete from drops where id between 1 and 5")
    op.execute("update reference_cards set colour_model_id = null where colour_model_id between 1 and 10")
    op.execute("delete from colour_models where id between 1 and 10")
    op.execute("delete from garment_models where id between 1 and 4")
    for level in ("category", "group", "gender", "direction"):
        op.execute(f"delete from hierarchy_nodes where id between 1 and 9 and level = '{level}'")

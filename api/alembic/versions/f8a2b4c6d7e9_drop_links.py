"""drop links

Принты и надписи относятся к дропам и адресату (US-0497): назначенное руками
— в library_drops и library_audiences, связь «через референс» считается из
живых референсов. Адресат модели — от узла «пол» иерархии.

Тестовые связи заведены сразу: принты набора разнесены по дропам по смыслу.
Ключ картинки — sha256 содержимого, тот же, что в fixtures/prints.yaml.

Revision ID: f8a2b4c6d7e9
Revises: e7f1a3b5c6d8
Create Date: 2026-09-25 16:10:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f8a2b4c6d7e9"
down_revision: str | None = "e7f1a3b5c6d8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

P = {
    "td-rusty": "c6d9ae1ce3c2519e3e6d6ced3b27e694d6360e22bf0fd9d5902a91f8e07d044a",
    "td-winter-camo": "fdc236ee0c5cc81381f6bfc249fc17651527b9c5ae5a2a84373eea8d652c42db",
    "is7": "baf76de0299a43fd2e1daf1e6a568df2500d3fcf7c634334f144a272cf296168",
    "is3-winter": "8ad8abc62ecf04aaef6a4ae6fd4ab6f616cda8571a924c7d2ca89c90d4ed6368",
    "conqueror": "19b54b08fcfe6bbb7ed9378cb8f02896ca402e455ca16e3e748a62f2a7e7a4ea",
    "t14": "ba06e2500bd1200140b3181ed2d70df7145ff9c7dd5305d135a27440c1f28d76",
    "t72-winter": "06e00a31d4b33a571798f5fd38477f52887f4a7857ef29b31bd85867c757f321",
    "ustinov": "5236839b927350c65da0c2318e3a464456e80a23e1605d9453967a804a94a761",
    "teddy-toy": "414b8097f1a3205642760c7e8745e2c06f6b64b430b69ec37a0ddf058e90b4d9",
    "christmas-tree": "dad40c4c1ab43773ef08418163531caf8fb8343c5b98dc354c0ed5acc36ac15f",
    "butterfly": "f81a0df7e3f3272dd4d822dcd96a5ae7ffa8de8a9707e20dfc2d1fdde1eeafc2",
    "rose": "93a769ba3145e66004aa2843551d4c1517c76f4d13f64dff776707b116177ed1",
    "flowers": "cb748b9fcac505251fcb98d940f88962cd47de5a9e55448a4ca5fc9f4c6f45c7",
    "owl": "f279b26427ad753d8c79f764b8dfd786c9585aa22f9455784d47d0254f8f322a",
    "unicorn": "4487790a1832f9816fe262af7be21f5d864d49e0dc5c873fcafa70d219a0d872",
    "ice-cream": "edeb005d07586fdfc41d4fe7f50dec643dbd1f52cd9c1b99fd802ba6bf9b3e07",
    "soccer": "e9c7e59794427757c953a77c45345db15c405ec7a2a721ab309a0fd7d772cc8e",
    "car-red": "18fbf7a1addcc401c361b1136fcbb176cf27f086df3220d415ee15f68515753a",
    "car-blue": "033cb135c1ed7f82fd7dbc743b75fbee446db6eb04ff408fa3f0894ad7b0e06e",
}
#: Дропы сида 9d5e2f3a4b61: 1 Зима 2026/27, 2 Новый год 2027, 3 23 февраля
#: 2027, 4 Весна 2027, 5 Лето 2026 (погашен).
DROPS = [
    (1, ["td-winter-camo", "is3-winter", "t72-winter", "td-rusty"]),
    (2, ["ustinov", "christmas-tree", "teddy-toy"]),
    (3, ["conqueror", "t14", "is7", "td-rusty", "car-red"]),
    (4, ["butterfly", "rose", "flowers", "owl", "unicorn"]),
    (5, ["ice-cream", "soccer", "car-blue"]),
]
AUDIENCES = [
    ("boys", ["td-rusty", "td-winter-camo", "is7", "is3-winter", "conqueror", "t14", "t72-winter",
              "car-red", "car-blue", "soccer"]),
    ("girls", ["butterfly", "rose", "flowers", "unicorn"]),
    ("all", ["ustinov", "teddy-toy", "christmas-tree", "owl", "ice-cream"]),
]


def upgrade() -> None:
    op.add_column("hierarchy_nodes", sa.Column("audience", sa.String(8), nullable=True))
    op.create_check_constraint("ck_hierarchy_audience", "hierarchy_nodes",
                               "audience is null or audience in ('boys', 'girls', 'all')")
    op.execute("update hierarchy_nodes set audience = 'girls' where level = 'gender' and name = 'Девочки'")
    op.execute("update hierarchy_nodes set audience = 'boys' where level = 'gender' and name = 'Мальчики'")

    drops = op.create_table(
        "library_drops",
        sa.Column("kind", sa.String(8), primary_key=True),
        sa.Column("key", sa.String(1024), primary_key=True),
        sa.Column("drop_id", sa.Integer(), sa.ForeignKey("drops.id", ondelete="RESTRICT"), primary_key=True),
        sa.Column("author_id", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("kind in ('image', 'text')", name="ck_library_drops_kind"),
    )
    audiences = op.create_table(
        "library_audiences",
        sa.Column("kind", sa.String(8), primary_key=True),
        sa.Column("key", sa.String(1024), primary_key=True),
        sa.Column("audience", sa.String(8), primary_key=True),
        sa.Column("author_id", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("kind in ('image', 'text')", name="ck_library_audiences_kind"),
        sa.CheckConstraint("audience in ('boys', 'girls', 'all')", name="ck_library_audiences_audience"),
    )
    op.bulk_insert(drops, [{"kind": "image", "key": P[n], "drop_id": d} for d, names in DROPS for n in names])
    op.bulk_insert(audiences, [{"kind": "image", "key": P[n], "audience": a} for a, names in AUDIENCES for n in names])


def downgrade() -> None:
    op.drop_table("library_audiences")
    op.drop_table("library_drops")
    op.drop_constraint("ck_hierarchy_audience", "hierarchy_nodes", type_="check")
    op.drop_column("hierarchy_nodes", "audience")

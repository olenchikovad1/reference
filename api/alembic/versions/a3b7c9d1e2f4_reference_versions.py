"""reference versions

Референс хранит версии (US-0490). Прежняя таблица карточек и была таблицей
версий — строка на сохранение, пути обновления нет, — поэтому она
переименовывается в reference_versions, а reference_cards заводится заново как
карточка. Каждая прежняя строка становится версией №1 своего референса, и
номер референса совпадает с прежним номером карточки: ссылки «карточка №12»
продолжают вести туда же.

Обратный шаг возвращает прежнее устройство: каждая версия снова отдельная
карточка, имя и цветомодель берутся от её референса. Связь «версии одного
референса» при этом теряется — в прежнем устройстве её негде хранить.

Revision ID: a3b7c9d1e2f4
Revises: 9d5e2f3a4b61
Create Date: 2026-09-25 12:05:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a3b7c9d1e2f4"
down_revision: str | None = "9d5e2f3a4b61"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.rename_table("reference_cards", "reference_versions")
    op.execute("alter index reference_cards_pkey rename to reference_versions_pkey")
    op.execute("alter sequence reference_cards_id_seq rename to reference_versions_id_seq")

    op.create_table(
        "reference_cards",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(512), nullable=False, server_default=""),
        sa.Column("colour_model_id", sa.Integer(),
                  sa.ForeignKey("colour_models.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("forked_from_version_id", sa.Integer(),
                  sa.ForeignKey("reference_versions.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.execute(
        "insert into reference_cards (id, name, colour_model_id, created_at) "
        "select id, name, colour_model_id, created_at from reference_versions"
    )
    op.execute(
        "select setval(pg_get_serial_sequence('reference_cards', 'id'), "
        "coalesce((select max(id) from reference_cards), 0) + 1, false)"
    )

    op.add_column("reference_versions", sa.Column("reference_id", sa.Integer(), nullable=True))
    op.add_column("reference_versions", sa.Column("number", sa.Integer(), nullable=True))
    op.execute("update reference_versions set reference_id = id, number = 1")
    op.alter_column("reference_versions", "reference_id", nullable=False)
    op.alter_column("reference_versions", "number", nullable=False)
    op.create_foreign_key(
        "reference_versions_reference_id_fkey", "reference_versions", "reference_cards",
        ["reference_id"], ["id"], ondelete="RESTRICT",
    )
    op.create_unique_constraint("uq_reference_version_number", "reference_versions", ["reference_id", "number"])
    op.create_check_constraint("ck_reference_version_number", "reference_versions", "number >= 1")
    # Имя и цветомодель теперь у карточки: в версии они разошлись бы с ней.
    op.drop_constraint("reference_cards_colour_model_id_fkey", "reference_versions", type_="foreignkey")
    op.drop_column("reference_versions", "colour_model_id")
    op.drop_column("reference_versions", "name")

    op.alter_column("reference_texts", "reference_id", new_column_name="version_id")
    op.execute("alter table reference_texts rename constraint reference_texts_reference_id_fkey "
               "to reference_texts_version_id_fkey")


def downgrade() -> None:
    op.execute("alter table reference_texts rename constraint reference_texts_version_id_fkey "
               "to reference_texts_reference_id_fkey")
    op.alter_column("reference_texts", "version_id", new_column_name="reference_id")

    op.add_column("reference_versions", sa.Column("name", sa.String(512), nullable=False, server_default=""))
    op.add_column("reference_versions", sa.Column("colour_model_id", sa.Integer(), nullable=True))
    op.execute(
        "update reference_versions v set name = c.name, colour_model_id = c.colour_model_id "
        "from reference_cards c where c.id = v.reference_id"
    )
    op.create_foreign_key(
        "reference_cards_colour_model_id_fkey", "reference_versions", "colour_models",
        ["colour_model_id"], ["id"], ondelete="RESTRICT",
    )
    op.drop_constraint("ck_reference_version_number", "reference_versions", type_="check")
    op.drop_constraint("uq_reference_version_number", "reference_versions", type_="unique")
    op.drop_constraint("reference_versions_reference_id_fkey", "reference_versions", type_="foreignkey")
    op.drop_column("reference_versions", "number")
    op.drop_column("reference_versions", "reference_id")
    op.drop_table("reference_cards")

    op.execute("alter sequence reference_versions_id_seq rename to reference_cards_id_seq")
    op.execute("alter index reference_versions_pkey rename to reference_cards_pkey")
    op.rename_table("reference_versions", "reference_cards")

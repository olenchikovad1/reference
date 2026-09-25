"""drop decisions

Предложенное в дроп получает статус и решение (US-0506): предложен,
одобрен, не одобрен — кто, когда, почему. Причина отказа обязательна, это
держит проверка в базе. Заведённые сидом f8a2b4c6d7e9 связи считаются
одобренными: они и есть «то, что в дропе уже идёт в работу».

Revision ID: a9b3c5d7e8f0
Revises: f8a2b4c6d7e9
Create Date: 2026-09-25 16:50:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a9b3c5d7e8f0"
down_revision: str | None = "f8a2b4c6d7e9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("library_drops", sa.Column("status", sa.String(10), nullable=False, server_default="proposed"))
    op.add_column("library_drops", sa.Column("decided_by", sa.String(64), nullable=True))
    op.add_column("library_drops", sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("library_drops", sa.Column("reason", sa.String(500), nullable=True))
    op.create_check_constraint("ck_library_drops_status", "library_drops",
                               "status in ('proposed', 'approved', 'rejected')")
    op.create_check_constraint("ck_library_drops_reason", "library_drops",
                               "status <> 'rejected' or coalesce(trim(reason), '') <> ''")
    op.execute("update library_drops set status = 'approved', decided_at = created_at")


def downgrade() -> None:
    op.drop_constraint("ck_library_drops_reason", "library_drops", type_="check")
    op.drop_constraint("ck_library_drops_status", "library_drops", type_="check")
    for col in ("reason", "decided_at", "decided_by", "status"):
        op.drop_column("library_drops", col)

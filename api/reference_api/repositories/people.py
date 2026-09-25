"""Люди приложения: как снимок достаётся и пересобирается. Бизнес-смысла здесь нет."""

from sqlalchemy import any_, delete, literal, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.models.people import Person, SubjectName


async def replace(db: AsyncSession, rows: list[dict]) -> None:
    """Снимок целиком, одной транзакцией: половинного снимка не бывает."""
    await db.execute(delete(Person))
    for r in rows:
        db.add(Person(id=r["id"], display_name=r["display_name"], kind=r["kind"],
                      organization_id=r.get("organization_id", ""), right_sets=list(r.get("right_sets", []))))
    if rows:
        stmt = insert(SubjectName).values([{"id": r["id"], "display_name": r["display_name"]} for r in rows])
        await db.execute(stmt.on_conflict_do_update(
            index_elements=[SubjectName.id],
            set_={"display_name": stmt.excluded.display_name, "seen_at": stmt.excluded.seen_at}))
    await db.commit()


async def listing(db: AsyncSession, right_set: str | None = None) -> list[Person]:
    q = select(Person).order_by(Person.display_name, Person.id)
    if right_set:
        # any_(), а не ARRAY.any(): второй в SQLAlchemy 2.1 устарел к удалению.
        q = q.where(literal(right_set) == any_(Person.right_sets))
    return list((await db.execute(q)).scalars())


async def names(db: AsyncSession, ids: list[str]) -> dict[str, str]:
    if not ids:
        return {}
    rows = await db.execute(select(SubjectName.id, SubjectName.display_name).where(SubjectName.id.in_(ids)))
    return {r.id: r.display_name for r in rows}

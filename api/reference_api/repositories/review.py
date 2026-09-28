"""Согласование: как хранятся статус и путь переходов. Бизнес-смысла здесь нет."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.models.references import Reference, ReferenceStatusEvent, ReferenceVersion


async def move(db: AsyncSession, reference_id: int, to: str, number: int, by_id: str | None,
               comment: str | None = None) -> None:
    """Сменить статус и записать переход — одной транзакцией."""
    card = await db.get(Reference, reference_id)
    db.add(ReferenceStatusEvent(reference_id=reference_id, from_status=card.status, to_status=to, number=number,
                                by_id=by_id, comment=comment))
    card.status = to
    await db.commit()


async def events(db: AsyncSession, reference_id: int) -> list[ReferenceStatusEvent]:
    rows = await db.execute(select(ReferenceStatusEvent).where(ReferenceStatusEvent.reference_id == reference_id)
                            .order_by(ReferenceStatusEvent.at, ReferenceStatusEvent.id))
    return list(rows.scalars())


async def last_number(db: AsyncSession, reference_id: int) -> int:
    rows = await db.execute(select(ReferenceVersion.number).where(ReferenceVersion.reference_id == reference_id)
                            .order_by(ReferenceVersion.number.desc()).limit(1))
    return rows.scalar_one()


async def in_statuses(db: AsyncSession, statuses: list[str]) -> list[Reference]:
    """Живые карточки в этих статусах — из них вычисляются «Мои задачи»."""
    rows = await db.execute(select(Reference).where(Reference.status.in_(statuses), Reference.deleted_at.is_(None))
                            .order_by(Reference.id.desc()))
    return list(rows.scalars())


async def last_returns(db: AsyncSession, ids: list[int]) -> dict[int, ReferenceStatusEvent]:
    """Последний возврат на доработку у каждой карточки — его замечание и есть
    причина задачи исполнителя."""
    if not ids:
        return {}
    rows = await db.execute(select(ReferenceStatusEvent)
                            .where(ReferenceStatusEvent.reference_id.in_(ids), ReferenceStatusEvent.to_status == "rework")
                            .order_by(ReferenceStatusEvent.at))
    return {e.reference_id: e for e in rows.scalars()}

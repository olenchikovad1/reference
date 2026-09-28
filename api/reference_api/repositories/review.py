"""Согласование: как хранятся статус и путь переходов. Бизнес-смысла здесь нет."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.models.references import (
    Reference,
    ReferenceRemark,
    ReferenceRemarkMessage,
    ReferenceStatusEvent,
    ReferenceVersion,
)


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


async def add_remark(db: AsyncSession, **fields) -> ReferenceRemark:
    row = ReferenceRemark(**fields)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def remark(db: AsyncSession, remark_id: int) -> ReferenceRemark | None:
    return await db.get(ReferenceRemark, remark_id)


async def remarks_of(db: AsyncSession, reference_id: int) -> list[ReferenceRemark]:
    rows = await db.execute(select(ReferenceRemark).where(ReferenceRemark.reference_id == reference_id)
                            .order_by(ReferenceRemark.id))
    return list(rows.scalars())


async def messages_of(db: AsyncSession, remark_ids: list[int]) -> dict[int, list[ReferenceRemarkMessage]]:
    out: dict[int, list[ReferenceRemarkMessage]] = {i: [] for i in remark_ids}
    if not remark_ids:
        return out
    rows = await db.execute(select(ReferenceRemarkMessage).where(ReferenceRemarkMessage.remark_id.in_(remark_ids))
                            .order_by(ReferenceRemarkMessage.at, ReferenceRemarkMessage.id))
    for m in rows.scalars():
        out[m.remark_id].append(m)
    return out


_KEEP = object()


async def say(db: AsyncSession, remark_id: int, kind: str, text: str | None, author_id: str | None, number: int,
              status: str | None = None, fixed_in=_KEEP) -> None:
    """Сообщение в ветку и, если оно меняет состояние, новое состояние
    замечания — одной транзакцией."""
    db.add(ReferenceRemarkMessage(remark_id=remark_id, kind=kind, text=text, author_id=author_id, number=number))
    row = await db.get(ReferenceRemark, remark_id)
    if status is not None:
        row.status = status
    if fixed_in is not _KEEP:
        row.fixed_in = fixed_in
    await db.commit()


async def open_counts(db: AsyncSession, ids: list[int]) -> dict[int, int]:
    """Сколько открытых замечаний у каждой карточки — для «Моих задач»."""
    if not ids:
        return {}
    from sqlalchemy import func

    rows = await db.execute(select(ReferenceRemark.reference_id, func.count())
                            .where(ReferenceRemark.reference_id.in_(ids), ReferenceRemark.status == "open")
                            .group_by(ReferenceRemark.reference_id))
    return dict(rows.all())

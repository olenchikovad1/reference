"""Согласование: как хранятся статус и путь переходов. Бизнес-смысла здесь нет."""

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.models.references import (
    Reference,
    ReferenceAgendaItem,
    ReferenceRemark,
    ReferenceRemarkMessage,
    ReferenceStatusEvent,
    ReferenceVersion,
)


async def move(db: AsyncSession, reference_id: int, to: str, number: int, by_id: str | None,
               comment: str | None = None) -> None:
    """Сменить статус и записать переход — одной транзакцией. Карточку
    сервис уже проверил в этой же сессии: её отсутствие здесь — ошибка кода."""
    card = await db.get_one(Reference, reference_id)
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
    row = await db.get_one(ReferenceRemark, remark_id)
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


# --- Голос (US-0512) -----------------------------------------------------


async def claim_voice(db: AsyncSession, remark_id: int) -> tuple[str | None, int] | None:
    """Взять расшифровку в работу: pending → working одним условным
    обновлением. Повтор сообщения или вторая копия сервиса получают None —
    второй раз не расшифровывается."""
    row = (await db.execute(
        update(ReferenceRemark)
        .where(ReferenceRemark.id == remark_id, ReferenceRemark.voice_status == "pending")
        .values(voice_status="working", voice_attempts=ReferenceRemark.voice_attempts + 1)
        .returning(ReferenceRemark.audio_digest, ReferenceRemark.voice_attempts)
    )).first()
    await db.commit()
    return (row[0], row[1]) if row else None


async def voice_state(db: AsyncSession, remark_id: int, status: str, error: str | None = None) -> None:
    await db.execute(update(ReferenceRemark).where(ReferenceRemark.id == remark_id)
                     .values(voice_status=status, voice_error=error))
    await db.commit()


async def voice_done(db: AsyncSession, remark_id: int, heard: str, seconds: float) -> None:
    """Расшифровка готова. Текст замечания становится расшифровкой, только
    если его ещё никто не вписал руками. Пока модель слушала, замечание
    могли стереть вместе с референсом из корзины — тогда писать некуда."""
    row = await db.get(ReferenceRemark, remark_id)
    if row is None:
        return
    row.heard, row.audio_seconds, row.voice_status, row.voice_error = heard, seconds, "done", None
    if not row.text:
        row.text = heard
    await db.commit()


async def voice_waiting(db: AsyncSession) -> list[int]:
    """Недошедшие до конца: ждут очереди или брошены умершим процессом —
    те возвращаются в pending."""
    await db.execute(update(ReferenceRemark).where(ReferenceRemark.voice_status == "working")
                     .values(voice_status="pending"))
    await db.commit()
    rows = await db.execute(select(ReferenceRemark.id).where(ReferenceRemark.voice_status == "pending")
                            .order_by(ReferenceRemark.id))
    return list(rows.scalars())


async def set_text(db: AsyncSession, remark_id: int, text: str) -> None:
    await db.execute(update(ReferenceRemark).where(ReferenceRemark.id == remark_id).values(text=text))
    await db.commit()


# --- Повестка (план 097) --------------------------------------------------

_OPEN = ReferenceAgendaItem.removed_at.is_(None)


async def propose(db: AsyncSession, reference_id: int, reason: str, by_id: str | None) -> None:
    db.add(ReferenceAgendaItem(reference_id=reference_id, reason=reason, by_id=by_id))
    await db.commit()


async def unpropose(db: AsyncSession, reference_id: int, by_id: str | None, resolution: str = "manual") -> None:
    """Убрать с повестки: вручную или решением (шаг статуса)."""
    from sqlalchemy import func

    await db.execute(update(ReferenceAgendaItem).where(ReferenceAgendaItem.reference_id == reference_id, _OPEN)
                         .values(removed_at=func.now(), removed_by=by_id, resolution=resolution))
    await db.commit()


async def open_agenda(db: AsyncSession, ids: list[int] | None = None) -> dict[int, list[ReferenceAgendaItem]]:
    """Открытые поводы по карточкам; ids — только этих."""
    q = select(ReferenceAgendaItem).where(_OPEN)
    if ids is not None:
        if not ids:
            return {}
        q = q.where(ReferenceAgendaItem.reference_id.in_(ids))
    out: dict[int, list[ReferenceAgendaItem]] = {}
    for item in (await db.execute(q.order_by(ReferenceAgendaItem.at))).scalars():
        out.setdefault(item.reference_id, []).append(item)
    return out


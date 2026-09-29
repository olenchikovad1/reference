"""Согласование: «Мои задачи» — вход по HTTP (US-0510)."""

from fastapi import APIRouter, Depends, HTTPException, Request
from platform_client import Action, requires
from platform_client.rights import RequiredRight
from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.db import session
from reference_api.schemas.references import (
    AgendaEventOut,
    AgendaOut,
    AgendaProposedOut,
    AgendaReasonOut,
    MeetingOut,
    TaskOut,
    TasksOut,
)
from reference_api.services import people, review

router = APIRouter(prefix="/tasks", tags=["review"])
agenda_router = APIRouter(prefix="/agenda", tags=["review"])


@router.get("", response_model=TasksOut, dependencies=[requires("review", Action.VIEW)])
async def my_tasks(request: Request, db: AsyncSession = Depends(session)) -> TasksOut:
    """Что ждёт именно меня и что я отдал — вычислением из статусов и ролей
    (И-8), без поля «ответственный»."""
    subject = getattr(request.state, "subject", None)
    # Задача моя, только если шаг мне доступен и по праву платформы (план 097):
    # главному без «Окончательного принятия» согласованное не «ждёт его».
    can_final = bool(subject and subject.has(RequiredRight("review", "approve-final", "function")))
    mine, waiting = await review.tasks(db, subject.id if subject else None, can_final=can_final)
    out = lambda ts: [TaskOut(id=t.id, name=t.name, status=t.status, reason=t.reason) for t in ts]  # noqa: E731
    return TasksOut(mine=out(mine), waiting=out(waiting))



async def _agenda_out(db: AsyncSession, a) -> AgendaOut:
    ms = await review.meetings(db)
    events = [e for es in a.decided.values() for e in es]
    ids = {i.by_id for items in a.proposed.values() for i in items} | {e.by_id for e in events} | {m.by_id for m in ms}
    who = await people.names_of(db, [i for i in ids if i])
    name = lambda i: who.get(i or "")  # noqa: E731
    ev = lambda es: [AgendaEventOut(reference_id=e.reference_id, from_=e.from_status, to=e.to_status, number=e.number,  # noqa: E731
                                    by_name=name(e.by_id), comment=e.comment, at=e.at) for e in es]
    meeting = lambda m: MeetingOut(id=m.id, held_at=m.held_at, by_name=name(m.by_id))  # noqa: E731
    return AgendaOut(
        meeting=meeting(a.meeting) if a.meeting else None, since=a.since, until=a.until,
        proposed=[AgendaProposedOut(reference_id=r, reasons=[AgendaReasonOut(reason=i.reason, by_id=i.by_id,
                                                                              by_name=name(i.by_id), at=i.at) for i in items])
                  for r, items in a.proposed.items()],
        approved=ev(a.decided["approved"]), rework=ev(a.decided["rework"]), rejected=ev(a.decided["rejected"]),
        undone=ev(a.decided["undone"]), meetings=[meeting(m) for m in ms],
    )


@agenda_router.get("", response_model=AgendaOut, dependencies=[requires("review", Action.VIEW)])
async def agenda(meeting: int | None = None, db: AsyncSession = Depends(session)) -> AgendaOut:
    """Повестка (план 097): что выдвинуто и решено с прошлой встречи;
    meeting=N — как было на той встрече."""
    try:
        return await _agenda_out(db, await review.agenda(db, meeting))
    except review.NoSuchReference as e:
        raise HTTPException(404, str(e)) from None


@agenda_router.post("/meetings", response_model=AgendaOut, dependencies=[requires("review", Action.WRITE)])
async def close_meeting(request: Request, db: AsyncSession = Depends(session)) -> AgendaOut:
    """«Встреча прошла»: выдвинутое — обсуждено, повестка — с этого момента."""
    subject = getattr(request.state, "subject", None)
    try:
        await review.close_meeting(db, subject.id if subject else None)
    except review.NotYourStep as e:
        raise HTTPException(403, str(e)) from None
    return await _agenda_out(db, await review.agenda(db))

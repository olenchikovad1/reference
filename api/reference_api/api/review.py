"""Согласование: «Мои задачи» — вход по HTTP (US-0510)."""

from fastapi import APIRouter, Depends, Request
from platform_client import Action, requires
from platform_client.rights import RequiredRight
from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.db import session
from reference_api.schemas.references import AgendaProposedOut, AgendaReasonOut, TaskOut, TasksOut
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
    out = lambda ts: [TaskOut(id=t.id, name=t.name, status=t.status, reason=t.reason) for t in ts]
    return TasksOut(mine=out(mine), waiting=out(waiting))




@agenda_router.get("", response_model=list[AgendaProposedOut], dependencies=[requires("agenda", Action.VIEW)])
async def agenda(db: AsyncSession = Depends(session)) -> list[AgendaProposedOut]:
    """Повестка (план 098): что выдвинуто на обсуждение и почему — пока по
    референсу не решили и не сняли вручную. Встреч в приложении нет."""
    items = await review.agenda_of(db)
    who = await people.names_of(db, [i.by_id for its in items.values() for i in its if i.by_id])
    return [AgendaProposedOut(reference_id=r, reasons=[AgendaReasonOut(reason=i.reason, by_id=i.by_id,
                                                                         by_name=who.get(i.by_id or ""), at=i.at)
                                                        for i in its])
            for r, its in items.items()]

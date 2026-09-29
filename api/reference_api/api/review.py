"""Согласование: «Мои задачи» — вход по HTTP (US-0510)."""

from fastapi import APIRouter, Depends, Request
from platform_client import Action, requires
from platform_client.rights import RequiredRight
from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.db import session
from reference_api.schemas.references import TaskOut, TasksOut
from reference_api.services import review

router = APIRouter(prefix="/tasks", tags=["review"])


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

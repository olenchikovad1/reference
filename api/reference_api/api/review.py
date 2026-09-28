"""Согласование: «Мои задачи» — вход по HTTP (US-0510)."""

from fastapi import APIRouter, Depends, Request
from platform_client import Action, requires
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
    mine, waiting = await review.tasks(db, subject.id if subject else None)
    out = lambda ts: [TaskOut(id=t.id, name=t.name, status=t.status, reason=t.reason) for t in ts]  # noqa: E731
    return TasksOut(mine=out(mine), waiting=out(waiting))

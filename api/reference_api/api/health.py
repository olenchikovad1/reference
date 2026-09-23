"""Проверки живости и готовности. Транспорт, домена у них нет.

Живость и готовность — разные состояния, и путать их дорого: процесс, который
запустился, но не видит базу, живой, а запросы обслуживать не может. Оркестратор
по живости решает, перезапускать ли, по готовности — пускать ли трафик.
"""

from fastapi import APIRouter
from sqlalchemy import text

from reference_api.db import session_factory

router = APIRouter(prefix="/health", tags=["health"])


@router.get("/live")
async def live() -> dict[str, str]:
    """Процесс отвечает. Про зависимости здесь ничего не утверждается."""
    return {"status": "ok"}


@router.get("/ready")
async def ready() -> dict[str, str]:
    """База отвечает на запрос. Без этого пускать трафик нельзя."""
    async with session_factory() as s:
        await s.execute(text("select 1"))
    return {"status": "ready", "database": "ok"}

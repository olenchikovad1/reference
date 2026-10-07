"""Четвёртый вход «Референса» — инструменты для ИИ-помощника (план 119).

Наравне с `api/`, `consumers/`, `schedulers/`: переводит вызов инструмента в
сервисный слой и правил предметной области не содержит. Протокол MCP,
проверку токена и права даёт общая библиотека платформы (решение платформы
0035): инструмент без права не объявить, без права его нет ни в списке, ни
при вызове. Помощник ходит правами своего человека (решение 0034) — ключ бота
страж меняет на токен человека, сюда он не доходит.

Файл на домен, как в остальных слоях; набор `tools` — один на приложение.
"""

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from platform_client import no_right
from platform_client.assistant_tools import INVALID_REQUEST, AssistantTools
from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.db import session

tools = AssistantTools(name="Референс")

# Регистрация инструментов — импортом модулей доменов: объявление идёт при
# импорте, и инструмент без права роняет подъём сервиса.
from reference_api.assistant import drops, references  # noqa: F401

router = APIRouter(tags=["помощник"])


@router.post(
    "/mcp",
    include_in_schema=False,
    # Права проверяет каждый инструмент отдельно — библиотека платформы
    # (решение 0035); маршрут лишь вход в неё.
    dependencies=[no_right("права — у каждого инструмента, проверяет библиотека платформы")],
)
async def mcp(request: Request, db: AsyncSession = Depends(session)) -> Response:
    """Точка MCP: JSON-RPC по HTTP без состояния. Без субъекта её как будто
    нет (404, как у любого чужого пути)."""
    subject = getattr(request.state, "subject", None)
    if subject is None:
        return Response(status_code=404)
    try:
        message = await request.json()
    except ValueError:
        return JSONResponse({"jsonrpc": "2.0", "id": None,
                             "error": {"code": INVALID_REQUEST, "message": "тело — не JSON"}})
    answered = await tools.answer(message, subject, context=db)
    return Response(status_code=202) if answered is None else JSONResponse(answered)


@router.get("/mcp", include_in_schema=False)
async def mcp_stream() -> Response:
    # Потока событий от сервера нет — протокол велит ответить 405.
    return Response(status_code=405)

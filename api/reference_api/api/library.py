"""Библиотека элементов: растр, текст, вектор. Происхождение, родословная,
использование по дропам.

Слой: api. Контракт и объявление прав. Вход по HTTP, правил предметной области нет.
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from platform_client import Action, requires
from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.db import session
from reference_api.schemas.library import FoundCardOut, TextIn, TextRowOut
from reference_api.services import library

router = APIRouter(prefix="/library", tags=["library"])


@router.get("/texts", response_model=list[TextRowOut])
async def texts(q: str | None = None, db: AsyncSession = Depends(session)) -> list[TextRowOut]:
    """Надписи: из референсов и заведённые заранее. С запросом — поиск по
    словам: «ЛЕТО 2025» находит и «ЛЕТО 2024» — похожим, с отметкой."""
    return [
        TextRowOut(
            text=r.text, fonts=sorted(r.fonts),
            references=[FoundCardOut(id=i, name=n) for i, n in sorted(r.references.items())],
            planned=r.planned, match=r.match,
            similarity=None if r.similarity is None else round(r.similarity, 3),
        )
        for r in await library.texts(db, q)
    ]


@router.post("/texts", status_code=204, dependencies=[requires("texts", Action.WRITE)])
async def plan_text(body: TextIn, request: Request, db: AsyncSession = Depends(session)) -> None:
    """Завести надпись заранее, до референса, — под будущий дроп."""
    if not body.text.strip():
        raise HTTPException(422, "пустая надпись")
    subject = getattr(request.state, "subject", None)
    await library.plan_text(db, body.text, subject.id if subject else None)

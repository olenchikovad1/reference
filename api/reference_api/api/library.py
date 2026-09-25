"""Библиотека элементов: растр, текст, вектор. Происхождение, родословная,
использование по дропам.

Слой: api. Контракт и объявление прав. Вход по HTTP, правил предметной области нет.
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from platform_client import Action, requires
from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.db import session
from reference_api.schemas.library import AudienceLinkOut, DropLinkOut, FoundCardOut, LinksIn, TextIn, TextRowOut
from reference_api.services import library

router = APIRouter(prefix="/library", tags=["library"])


@router.get("/texts", response_model=list[TextRowOut])
async def texts(q: str | None = None, db: AsyncSession = Depends(session)) -> list[TextRowOut]:
    """Надписи: из референсов и заведённые заранее. С запросом — поиск по
    словам: «ЛЕТО 2025» находит и «ЛЕТО 2024» — похожим, с отметкой."""
    return [
        TextRowOut(
            text=r.text, key=r.normalised, fonts=sorted(r.fonts),
            drops=[DropLinkOut(id=d.id, name=d.name, retired=d.retired, via=d.via, status=d.status, reason=d.reason) for d in r.links.drops.values()]
            if r.links else [],
            audiences=[AudienceLinkOut(code=a, via=v) for a, v in r.links.audiences.items()] if r.links else [],
            categories=sorted(r.links.categories) if r.links else [],
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


async def _link(kind: str, body: LinksIn, request: Request, db: AsyncSession) -> None:
    subject = getattr(request.state, "subject", None)
    try:
        await library.link(db, kind, body.keys, body.drop_id, body.audience, body.remove,
                           subject.id if subject else None)
    except library.BadLink as refusal:
        raise HTTPException(422, str(refusal)) from None


@router.post("/images/links", status_code=204, dependencies=[requires("prints", Action.WRITE)])
async def link_images(body: LinksIn, request: Request, db: AsyncSession = Depends(session)) -> None:
    """Назначить принтам дроп или адресат — нескольким разом (US-0497)."""
    await _link("image", body, request, db)


@router.post("/texts/links", status_code=204, dependencies=[requires("texts", Action.WRITE)])
async def link_texts(body: LinksIn, request: Request, db: AsyncSession = Depends(session)) -> None:
    """Назначить надписям дроп или адресат — нескольким разом (US-0497)."""
    await _link("text", body, request, db)

"""Собранный принт: вход по HTTP."""

from fastapi import APIRouter, Depends, HTTPException, Request
from platform_client import Action, requires
from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.db import session
from reference_api.schemas.references import (
    CardOut,
    CardWorkOut,
    FoundOut,
    ReferenceMatchOut,
    SavedOut,
    SaveIn,
)
from reference_api.services import references as service

router = APIRouter(prefix="/references", tags=["references"])


@router.post("", response_model=SavedOut, dependencies=[requires("references", Action.WRITE)])
async def save(body: SaveIn, request: Request, db: AsyncSession = Depends(session)) -> SavedOut:
    """Сохраняет собранный принт и сразу говорит, что узналось."""
    # Субъекта кладёт посредник платформы (app.py); нет токена или он не
    # принят — None: отказ без права делает объявление на маршруте (US-0487).
    subject = getattr(request.state, "subject", None)
    card_id, found = await service.save(
        db, body.name, body.sheet_digest, body.image_digests, body.texts, body.work,
        author_id=subject.id if subject else None,
    )
    return SavedOut(
        id=card_id,
        matches=[
            ReferenceMatchOut(
                by=m.by,
                reference_id=m.reference_id,
                name=m.name,
                similarity=m.similarity,
                level=m.level,
                text=m.text,
            )
            for m in found
        ],
    )


@router.get("/search", response_model=list[FoundOut])
async def search(q: str, db: AsyncSession = Depends(session)) -> list[FoundOut]:
    """Точный поиск по надписи.

    Именно точный: «где мы писали ЛЕТО 2025» — это совпадение слов, а не
    «что-то про лето». Вектор здесь вернул бы похожее, и человек решил бы, что
    поиск сломан.
    """
    return [FoundOut(id=i, name=n) for i, n in await service.search(db, q)]


@router.get("", response_model=list[CardOut])
async def latest(db: AsyncSession = Depends(session)) -> list[CardOut]:
    """Сохранённые карточки, свежие первыми."""
    return [CardOut(id=c.id, name=c.name, created_at=c.created_at, author_id=c.author_id)
            for c in await service.latest(db)]


# Объявлен ПОСЛЕ /search: иначе «search» разбирался бы как номер карточки и
# падал бы проверкой типа, а не находил поиск.
@router.get("/{card_id}", response_model=CardWorkOut)
async def open_card(card_id: int, db: AsyncSession = Depends(session)) -> CardWorkOut:
    """Карточка с работой — чтобы открыть её там, где сохранили, или на другом
    компьютере."""
    card = await service.open_card(db, card_id)
    if card is None:
        raise HTTPException(404, "карточки с таким номером нет")
    return CardWorkOut(id=card.id, name=card.name, created_at=card.created_at, author_id=card.author_id, work=card.work)

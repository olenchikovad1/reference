"""Собранный принт: вход по HTTP."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.db import session
from reference_api.schemas.references import FoundOut, ReferenceMatchOut, SavedOut, SaveIn
from reference_api.services import references as service

router = APIRouter(prefix="/references", tags=["references"])


@router.post("", response_model=SavedOut)
async def save(body: SaveIn, db: AsyncSession = Depends(session)) -> SavedOut:
    """Сохраняет собранный принт и сразу говорит, что узналось."""
    card_id, found = await service.save(
        db, body.name, body.sheet_digest, body.image_digests, body.texts
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

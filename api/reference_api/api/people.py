"""Люди приложения: вход по HTTP."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.db import session
from reference_api.services import people

router = APIRouter(prefix="/people", tags=["people"])


class PersonOut(BaseModel):
    id: str
    display_name: str
    right_sets: list[str]


@router.get("", response_model=list[PersonOut])
async def listing(right_set: str | None = None, db: AsyncSession = Depends(session)) -> list[PersonOut]:
    """Кто сейчас с доступом к «Референсу», по ФИО; с right_set — только с этим
    набором прав («designer», «editor»…): выбор исполнителя и согласующих."""
    return [PersonOut(id=p.id, display_name=p.display_name, right_sets=p.right_sets)
            for p in await people.listing(db, right_set)]

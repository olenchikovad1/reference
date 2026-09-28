"""Люди приложения: вход по HTTP."""

from fastapi import APIRouter, Depends, HTTPException, Request
from platform_client import Action, requires
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.db import session
from reference_api.services import people

router = APIRouter(prefix="/people", tags=["people"])


class PersonOut(BaseModel):
    id: str
    #: ФИО из таблицы ролей; нет — имя из платформы.
    display_name: str
    #: Наборы прав «Референса» по снимку платформы; нет доступа — пусто.
    right_sets: list[str] = []
    #: ФИО или ФИ, вписанное в приложении (решение 0016); нет — не вписано.
    full_name: str | None = None
    #: designer, editor, chief — роль в согласовании; нет — не назначена.
    role: str | None = None
    #: Есть ли сейчас доступ к «Референсу».
    access: bool


class PersonIn(BaseModel):
    full_name: str
    role: str


@router.get("", response_model=list[PersonOut])
async def listing(right_set: str | None = None, db: AsyncSession = Depends(session)) -> list[PersonOut]:
    """Все люди приложения, по ФИО: и с доступом, и с ролью — друг друга знают
    все (решение 0016). С right_set — только у кого этот набор прав."""
    sets = {p.id: p.right_sets for p in await people.listing(db)}
    return [
        PersonOut(id=m.id, display_name=m.name, right_sets=sets.get(m.id, []), full_name=m.full_name,
                  role=m.role, access=m.access)
        for m in await people.everyone(db)
        if right_set is None or right_set in sets.get(m.id, [])
    ]


@router.put("/{subject_id}", response_model=PersonOut, dependencies=[requires("dictionaries", Action.WRITE)])
async def set_role(subject_id: str, body: PersonIn, request: Request, db: AsyncSession = Depends(session)) -> PersonOut:
    """Роль в согласовании и ФИО человека (решение 0016). Доступа не даёт:
    войти и сохранять разрешает платформа."""
    subject = getattr(request.state, "subject", None)
    try:
        m = await people.set_role(db, subject_id, body.full_name, body.role, subject.id if subject else None)
    except people.BadPerson as e:
        raise HTTPException(422, str(e)) from None
    return PersonOut(id=m.id, display_name=m.name, full_name=m.full_name, role=m.role, access=m.access)

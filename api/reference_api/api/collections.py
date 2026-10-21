"""Разработка коллекции — вход по HTTP (решение 0020).

Правил предметной области нет: они в `services/collections.py`. Коллекция и
базы читаются из PLM в момент запроса (решение 0018); PLM не ответил — 503,
доска без шапки и баз смысла не имеет.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Form, HTTPException, Query, Request, UploadFile
from platform_client import Action, requires
from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.db import session
from reference_api.schemas.collections import (
    AddedOut,
    LabelIn,
    LabelOut,
    LabelPatch,
    PlaceIn,
    SetLabelIn,
    ShelfIn,
)
from reference_api.services import assets, plm
from reference_api.services import collections as service

__all__ = ["router"]

router = APIRouter(prefix="/collections", tags=["collections"])


def _viewer(request: Request) -> str | None:
    subject = getattr(request.state, "subject", None)
    return subject.id if subject else None


def _plm_failure(exc: Exception) -> HTTPException:
    if isinstance(exc, plm.PlmUnavailable):
        return HTTPException(503, {"code": "plm_unavailable", "message": str(exc)})
    return HTTPException(502, {"code": "plm_refused", "message": str(exc)})


def _label(row: Any) -> LabelOut:
    return LabelOut(id=row.id, name=row.name, tone=row.tone, position=row.position, active=row.active)


@router.get("", dependencies=[requires("collections", Action.VIEW)])
async def collections(
    q: str | None = Query(default=None, max_length=200), db: AsyncSession = Depends(session)
) -> dict[str, Any]:
    """Релизы PLM для выбора коллекции и сколько в каждом вариантов."""
    try:
        return {"items": await service.collections(db, q)}
    except (plm.PlmUnavailable, plm.PlmRefused) as failure:
        raise _plm_failure(failure) from failure


@router.get("/labels", response_model=list[LabelOut], dependencies=[requires("collections", Action.VIEW)])
async def labels(db: AsyncSession = Depends(session)) -> list[LabelOut]:
    """Справочник меток, погашенные тоже — с признаком."""
    return [_label(row) for row in await service.labels(db)]


@router.post("/labels", response_model=LabelOut, dependencies=[requires("collections", Action.WRITE)])
async def add_label(body: LabelIn, db: AsyncSession = Depends(session)) -> LabelOut:
    try:
        return _label(await service.add_label(db, body.name, body.tone))
    except service.LabelRefused as refusal:
        raise HTTPException(422, {"code": "label_refused", "message": str(refusal)}) from None


@router.patch("/labels/{label_id}", response_model=LabelOut, dependencies=[requires("collections", Action.WRITE)])
async def change_label(label_id: int, body: LabelPatch, db: AsyncSession = Depends(session)) -> LabelOut:
    try:
        row = await service.change_label(
            db, label_id, name=body.name, tone=body.tone, active=body.active, position=body.position
        )
    except service.LabelRefused as refusal:
        raise HTTPException(422, {"code": "label_refused", "message": str(refusal)}) from None
    return _label(row)


@router.put(
    "/variants/{reference_id}/label", status_code=204, dependencies=[requires("collections", Action.WRITE)]
)
async def set_label(reference_id: int, body: SetLabelIn, request: Request, db: AsyncSession = Depends(session)) -> None:
    try:
        await service.set_label(db, reference_id, body.label_id, _viewer(request))
    except service.NoSuchVariant as missing:
        raise HTTPException(404, {"code": "variant_missing", "message": str(missing)}) from None
    except service.LabelRefused as refusal:
        raise HTTPException(422, {"code": "label_refused", "message": str(refusal)}) from None


@router.post(
    "/variants/{reference_id}/seen", status_code=204, dependencies=[requires("collections", Action.VIEW)]
)
async def seen(reference_id: int, request: Request, db: AsyncSession = Depends(session)) -> None:
    """Человек открыл вариант — точка «новое» у него гаснет."""
    try:
        await service.mark_seen(db, reference_id, _viewer(request))
    except service.NoSuchVariant as missing:
        raise HTTPException(404, {"code": "variant_missing", "message": str(missing)}) from None


@router.put(
    "/variants/{reference_id}/shelf", status_code=204, dependencies=[requires("collections", Action.WRITE)]
)
async def shelf(reference_id: int, body: ShelfIn, request: Request, db: AsyncSession = Depends(session)) -> None:
    """«Отложено» у своей базы — вместо удаления; вернуть тем же путём."""
    try:
        await service.shelve(db, reference_id, body.shelved, _viewer(request))
    except service.NoSuchVariant as missing:
        raise HTTPException(404, {"code": "variant_missing", "message": str(missing)}) from None


@router.get("/{release_id}", dependencies=[requires("collections", Action.VIEW)])
async def board(release_id: str, request: Request, db: AsyncSession = Depends(session)) -> dict[str, Any]:
    """Доска: шапка коллекции, базы и колонки цветов с вариантами."""
    try:
        return await service.board(db, release_id, _viewer(request))
    except service.CollectionMissing as missing:
        raise HTTPException(404, {"code": "collection_missing", "message": str(missing)}) from None
    except (plm.PlmUnavailable, plm.PlmRefused) as failure:
        raise _plm_failure(failure) from failure


@router.post(
    "/{release_id}/variants",
    response_model=list[AddedOut],
    dependencies=[requires("collections", Action.WRITE)],
)
async def add_variants(
    release_id: str,
    request: Request,
    files: list[UploadFile],
    style_id: str = Form(min_length=1, max_length=64),
    colorway_id: str | None = Form(default=None, max_length=64),
    db: AsyncSession = Depends(session),
) -> list[AddedOut]:
    """Картинки в колонку цвета или в «Идеи» базы (цвет не прислан): каждая —
    свой вариант (вставка, пачка файлов)."""
    batch: list[tuple[str, bytes]] = []
    for f in files:
        name = f.filename or "вставка.png"
        try:
            # Объявленный размер — до чтения, настоящий проверит store.
            assets.check_size(name, f.size)
        except assets.TooLarge as e:
            raise HTTPException(413, {"code": "file_too_large", "reason": str(e)}) from None
        batch.append((name, await f.read()))
    try:
        added = await service.add_variants(db, release_id, style_id, colorway_id or None, batch, _viewer(request))
    except service.CollectionMissing as missing:
        raise HTTPException(404, {"code": "collection_missing", "message": str(missing)}) from None
    except service.NotInCollection as refusal:
        raise HTTPException(422, {"code": "colorway_not_in_collection", "message": str(refusal)}) from None
    except assets.TooLarge as e:
        raise HTTPException(413, {"code": "file_too_large", "reason": str(e)}) from None
    except assets.NotAnImage as e:
        raise HTTPException(415, {"code": "not_an_image", "message": f"содержимое не опознано как изображение ({e})"}) from None
    except (plm.PlmUnavailable, plm.PlmRefused) as failure:
        raise _plm_failure(failure) from failure
    return [AddedOut(id=a.id, number=a.number, name=a.name, image=a.image) for a in added]


@router.put("/{release_id}/place", status_code=204, dependencies=[requires("collections", Action.WRITE)])
async def place(release_id: str, body: PlaceIn, db: AsyncSession = Depends(session)) -> None:
    """Перестановка: колонка в присланном порядке, перенесённые едут со всеми
    данными, взятые с полки возвращаются в работу."""
    try:
        await service.place(db, release_id, body.style_id, body.colorway_id or None, body.ids)
    except service.CollectionMissing as missing:
        raise HTTPException(404, {"code": "collection_missing", "message": str(missing)}) from None
    except service.NotInCollection as refusal:
        raise HTTPException(422, {"code": "colorway_not_in_collection", "message": str(refusal)}) from None
    except service.NoSuchVariant as missing:
        raise HTTPException(404, {"code": "variant_missing", "message": str(missing)}) from None
    except (plm.PlmUnavailable, plm.PlmRefused) as failure:
        raise _plm_failure(failure) from failure

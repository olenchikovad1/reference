"""Дропы, их ассортимент и справочники: товарная иерархия, модели, цветомодели, адресаты.

Слой: api. Контракт и объявление прав. Вход по HTTP, правил предметной области нет.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.db import session
from reference_api.models.drops import GarmentModel, HierarchyNode
from reference_api.schemas.drops import (
    DropOut,
    MatrixOut,
    ModelOut,
    TreeColourModelOut,
    TreeModelOut,
    TreeNodeOut,
)
from reference_api.services import drops as service

router = APIRouter(tags=["drops"])


def _model(m: GarmentModel) -> ModelOut:
    w = service.workability(m)
    return ModelOut(id=m.id, code=m.code, name=m.name, category=m.category.name, can_work=w.can_work, reason=w.reason)


@router.get("/drops", response_model=list[DropOut])
async def drops(active: bool = False, db: AsyncSession = Depends(session)) -> list[DropOut]:
    """Дропы по дате выхода. active=true — без погашенных: для нового референса."""
    return [DropOut.model_validate(d, from_attributes=True) for d in await service.drops(db, active)]


@router.get("/drops/{drop_id}/matrix", response_model=MatrixOut)
async def matrix(drop_id: int, db: AsyncSession = Depends(session)) -> MatrixOut:
    """Ассортимент дропа матрицей «модели × цвета»."""
    try:
        m = await service.matrix(db, drop_id)
    except service.DropNotFound:
        raise HTTPException(status_code=404, detail=f"нет дропа {drop_id}") from None
    return MatrixOut(
        drop=DropOut.model_validate(m["drop"], from_attributes=True),
        colours=m["colours"],
        rows=[{"model": _model(r["model"]), "cells": r["cells"]} for r in m["rows"]],
    )


def _node(n: HierarchyNode) -> TreeNodeOut:
    return TreeNodeOut(
        id=n.id,
        level=n.level,
        name=n.name,
        audience=n.audience,
        children=[_node(c) for c in sorted(n.children, key=lambda c: c.name)],
        models=[
            TreeModelOut(
                **_model(m).model_dump(),
                colour_models=[
                    TreeColourModelOut(id=cm.id, colour_code=cm.colour_code, drops=[d.name for d in cm.drops],
                                       drop_ids=[d.id for d in cm.drops])
                    for cm in m.colour_models
                ],
            )
            for m in sorted(n.models, key=lambda m: m.code)
        ],
    )


@router.get("/catalogue", response_model=list[TreeNodeOut])
async def catalogue(db: AsyncSession = Depends(session)) -> list[TreeNodeOut]:
    """Товарная иерархия деревом: модели с цветомоделями и дропами, где те выходят."""
    return [_node(n) for n in await service.tree(db)]

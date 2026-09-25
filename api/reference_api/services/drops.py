"""Дропы, их ассортимент и справочники: товарная иерархия, модели, цветомодели, адресаты.

Слой: services. Правила предметной области. Единственный слой, который их содержит.

Справочники свои (решение 0013). Правил здесь два: ассортимент дропа
показывается матрицей «модели × цвета» — одна модель живёт в нескольких дропах
разными цветами, и в дереве она повторялась бы; на модели без кадров работу не
начать, и причина названа, а не спрятана.
"""

from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.models.drops import ColourModel, Drop, GarmentModel, HierarchyNode
from reference_api.repositories import drops as repo
from reference_api.repositories import products as products_repo
from reference_api.services import colours

NO_FRAMES = "у изделия нет кадров для работы"


class DropNotFound(Exception):
    """Такого дропа нет."""


class CannotWork(Exception):
    """На цветомодели работу не начать: нет такой или у изделия нет кадров."""


@dataclass(frozen=True)
class Workability:
    can_work: bool
    reason: str | None


def workability(model: GarmentModel) -> Workability:
    """Можно ли рисовать на модели: нужно изделие приложения с кадрами."""
    if not model.product_code or products_repo.load_product(model.product_code) is None:
        return Workability(False, NO_FRAMES)
    return Workability(True, None)


async def drops(db: AsyncSession, active_only: bool = False) -> list[Drop]:
    return await repo.drops(db, active_only)


def _palette_by_code() -> dict[str, dict[str, Any]]:
    return {c["code"]: c for c in colours.palette()["colors"]}


async def matrix(db: AsyncSession, drop_id: int) -> dict[str, Any]:
    """Ассортимент дропа: строки — модели, столбцы — цвета, в ячейке —
    цветомодель и сколько на ней референсов. Ноль — «ещё не нарисовано»."""
    d = await repo.drop(db, drop_id)
    if d is None:
        raise DropNotFound(drop_id)
    counts = await repo.references_by_colour_model(db, [cm.id for cm in d.items])
    palette = _palette_by_code()
    order = list(palette)
    models: dict[int, GarmentModel] = {}
    cells: dict[int, dict[str, dict[str, int]]] = {}
    for cm in d.items:
        models[cm.model_id] = cm.model
        cells.setdefault(cm.model_id, {})[cm.colour_code] = {
            "colour_model_id": cm.id, "references": counts.get(cm.id, 0)}
    used = sorted({cm.colour_code for cm in d.items}, key=lambda c: order.index(c) if c in order else len(order))
    return {
        "drop": d,
        "colours": [{"code": c, "name": palette.get(c, {}).get("group", c), "rgb": palette.get(c, {}).get("rgb")}
                    for c in used],
        "rows": [{"model": models[mid], "cells": cells[mid]} for mid in sorted(models, key=lambda i: models[i].code)],
    }


async def tree(db: AsyncSession) -> list[HierarchyNode]:
    return await repo.roots(db)


async def colour_model_for_work(db: AsyncSession, colour_model_id: int) -> ColourModel:
    """Цветомодель, на которой можно рисовать; иначе — отказ с причиной."""
    cm = await repo.colour_model(db, colour_model_id)
    if cm is None:
        raise CannotWork(f"нет цветомодели {colour_model_id}")
    w = workability(cm.model)
    if not w.can_work:
        raise CannotWork(w.reason or NO_FRAMES)
    return cm


@dataclass(frozen=True)
class DropRef:
    id: int
    name: str
    retired: bool


@dataclass(frozen=True)
class ColourPlace:
    """Где цветомодель: цвет палитры, дропы, адресат и вид одежды (US-0497).
    Референс берёт всё это от своей цветомодели."""

    colour_code: str
    #: Сначала действующие, погашенные в конце: погашенный остаётся виден там,
    #: где стоит, но первым его не называют.
    drops: list[str]
    drop_refs: list[DropRef]
    #: boys, girls — от узла «пол» над моделью; all — пола в иерархии нет.
    audience: str
    #: Вид одежды — категория модели: «Худи», «Футболки».
    category: str


def audience_of(category_id: int, nodes: dict[int, HierarchyNode]) -> str:
    """Адресат модели — от ближайшего узла с адресатом вверх по иерархии."""
    node = nodes.get(category_id)
    while node is not None:
        if node.audience:
            return node.audience
        node = nodes.get(node.parent_id) if node.parent_id else None
    return "all"


async def colour_models_of(db: AsyncSession, ids: list[int]) -> dict[int, ColourPlace]:
    """Место цветомоделей разом — для списка референсов и связей библиотеки."""
    found = await repo.colour_models(db, sorted(set(ids)))
    nodes = await repo.nodes(db) if found else {}
    out: dict[int, ColourPlace] = {}
    for cm_id, cm in found.items():
        ordered = sorted(cm.drops, key=lambda d: (d.retired, d.release_from))
        category = nodes.get(cm.model.category_id)
        out[cm_id] = ColourPlace(
            cm.colour_code,
            [d.name for d in ordered],
            [DropRef(d.id, d.name, d.retired) for d in ordered],
            audience_of(cm.model.category_id, nodes),
            category.name if category else "",
        )
    return out


async def check_drop_for_linking(db: AsyncSession, drop_id: int) -> Drop:
    """Дроп, которому можно назначить принт или надпись. Погашенный в выборе
    не предлагается — назначать в него нельзя, хотя стоящее там видно."""
    d = await repo.drop(db, drop_id)
    if d is None:
        raise DropNotFound(drop_id)
    if d.retired:
        raise CannotWork(f"дроп «{d.name}» погашен — назначать в него нельзя")
    return d

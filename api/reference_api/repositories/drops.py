"""Дропы, их ассортимент и справочники: товарная иерархия, модели, цветомодели, адресаты.

Слой: repositories. Как данные достаются. Бизнес-смысла здесь нет.
"""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.models.drops import ColourModel, Drop, HierarchyNode
from reference_api.models.references import Reference


async def drops(db: AsyncSession, active_only: bool = False) -> list[Drop]:
    # Погашенные в конце: для работы их не выбирают, а видеть — видят.
    q = select(Drop).order_by(Drop.retired, Drop.release_from, Drop.name)
    if active_only:
        q = q.where(Drop.retired.is_(False))
    return list((await db.execute(q)).scalars())


async def drop(db: AsyncSession, drop_id: int) -> Drop | None:
    return await db.get(Drop, drop_id)


async def colour_model(db: AsyncSession, colour_model_id: int) -> ColourModel | None:
    return await db.get(ColourModel, colour_model_id)


async def colour_models(db: AsyncSession, ids: list[int]) -> dict[int, ColourModel]:
    """Цветомодели разом, с дропами: список референсов называет дроп каждого."""
    if not ids:
        return {}
    rows = await db.execute(select(ColourModel).where(ColourModel.id.in_(ids)))
    return {cm.id: cm for cm in rows.scalars()}


async def references_by_colour_model(db: AsyncSession, ids: list[int]) -> dict[int, int]:
    """Сколько референсов на каждой цветомодели."""
    if not ids:
        return {}
    rows = await db.execute(
        select(Reference.colour_model_id, func.count())
        .where(Reference.colour_model_id.in_(ids))
        .group_by(Reference.colour_model_id)
    )
    return {cm: n for cm, n in rows}


async def roots(db: AsyncSession) -> list[HierarchyNode]:
    """Верх товарной иерархии; дети, модели и цветомодели подгружаются связями."""
    q = select(HierarchyNode).where(HierarchyNode.parent_id.is_(None)).order_by(HierarchyNode.name)
    return list((await db.execute(q)).scalars())

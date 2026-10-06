"""Дропы, их ассортимент и справочники: товарная иерархия, модели, цветомодели, адресаты.

Слой: repositories. Как данные достаются. Бизнес-смысла здесь нет.
"""

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.models.drops import ColourModel, Drop, DropItem, GarmentModel, HierarchyNode
from reference_api.models.library import LibraryDrop
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
        .where(Reference.colour_model_id.in_(ids), Reference.deleted_at.is_(None))
        .group_by(Reference.colour_model_id)
    )
    return {cm: n for cm, n in rows if cm is not None}


async def nodes(db: AsyncSession) -> dict[int, HierarchyNode]:
    """Вся иерархия разом: узлов десятки, и подниматься от категории к полу
    в памяти дешевле, чем ленивыми запросами по одному."""
    rows = await db.execute(select(HierarchyNode))
    return {n.id: n for n in rows.scalars()}


async def roots(db: AsyncSession) -> list[HierarchyNode]:
    """Верх товарной иерархии; дети, модели и цветомодели подгружаются связями."""
    q = select(HierarchyNode).where(HierarchyNode.parent_id.is_(None)).order_by(HierarchyNode.name)
    return list((await db.execute(q)).scalars())


async def drop_by_name(db: AsyncSession, name: str) -> Drop | None:
    return await db.scalar(select(Drop).where(func.lower(Drop.name) == name.lower()))


async def save_drop(db: AsyncSession, drop: Drop) -> Drop:
    db.add(drop)
    await db.commit()
    await db.refresh(drop)
    return drop


async def drop_use(db: AsyncSession, drop_id: int) -> tuple[int, int]:
    """Сколько цветомоделей в ассортименте и сколько принтов и надписей предложено."""
    items = await db.scalar(select(func.count()).select_from(DropItem).where(DropItem.drop_id == drop_id))
    proposed = await db.scalar(select(func.count()).select_from(LibraryDrop).where(LibraryDrop.drop_id == drop_id))
    return items or 0, proposed or 0


async def delete_drop(db: AsyncSession, drop_id: int) -> None:
    await db.execute(delete(Drop).where(Drop.id == drop_id))
    await db.commit()


async def garment_model(db: AsyncSession, model_id: int) -> GarmentModel | None:
    return await db.get(GarmentModel, model_id)


async def colour_model_of(db: AsyncSession, model_id: int, colour_code: str) -> ColourModel | None:
    return await db.scalar(select(ColourModel).where(ColourModel.model_id == model_id, ColourModel.colour_code == colour_code))


async def add_item(db: AsyncSession, drop_id: int, model_id: int, colour_code: str) -> None:
    """Цветомодель в ассортимент: нет такой — заводится; уже в дропе — ничего."""
    cm = await colour_model_of(db, model_id, colour_code)
    if cm is None:
        cm = ColourModel(model_id=model_id, colour_code=colour_code)
        db.add(cm)
        await db.flush()
    exists = await db.scalar(select(DropItem).where(DropItem.drop_id == drop_id, DropItem.colour_model_id == cm.id))
    if exists is None:
        db.add(DropItem(drop_id=drop_id, colour_model_id=cm.id))
    await db.commit()


async def remove_item(db: AsyncSession, drop_id: int, colour_model_id: int) -> None:
    await db.execute(delete(DropItem).where(DropItem.drop_id == drop_id, DropItem.colour_model_id == colour_model_id))
    await db.commit()

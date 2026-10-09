"""Связь артикула PLM с кодом изделия кадров — без бизнес-смысла."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.models.drops import PlmProductLink

__all__ = ["product_code", "product_codes", "upsert", "all_links"]


async def product_code(db: AsyncSession, style_code: str) -> str | None:
    row = await db.get(PlmProductLink, style_code)
    return row.product_code if row else None


async def product_codes(db: AsyncSession, style_codes: list[str]) -> dict[str, str]:
    if not style_codes:
        return {}
    rows = (
        await db.scalars(select(PlmProductLink).where(PlmProductLink.style_code.in_(style_codes)))
    ).all()
    return {r.style_code: r.product_code for r in rows}


async def upsert(db: AsyncSession, *, style_code: str, product_code: str) -> None:
    stmt = insert(PlmProductLink).values(style_code=style_code, product_code=product_code)
    stmt = stmt.on_conflict_do_update(
        index_elements=[PlmProductLink.style_code],
        set_={"product_code": product_code},
    )
    await db.execute(stmt)


async def all_links(db: AsyncSession) -> list[PlmProductLink]:
    return list(await db.scalars(select(PlmProductLink).order_by(PlmProductLink.style_code)))

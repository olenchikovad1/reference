"""Названия файлов: как хранятся и как достаются. Бизнес-смысла здесь нет."""

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.models.library import AssetName


async def get(db: AsyncSession, digest: str) -> AssetName | None:
    return await db.get(AssetName, digest)


async def put(db: AsyncSession, digest: str, name: str, source: str, from_digest: str | None) -> AssetName:
    """Название файла ставится заново целиком: источник сменился — сменилось
    и всё остальное."""
    values = {"name": name, "source": source, "from_digest": from_digest}
    await db.execute(
        insert(AssetName)
        .values(digest=digest, **values)
        .on_conflict_do_update(index_elements=[AssetName.digest], set_=values)
    )
    await db.commit()
    got = await db.get(AssetName, digest, populate_existing=True)
    assert got is not None
    return got


async def of(db: AsyncSession, digests: list[str]) -> dict[str, AssetName]:
    rows = await db.execute(select(AssetName).where(AssetName.digest.in_(digests)))
    return {r.digest: r for r in rows.scalars()}

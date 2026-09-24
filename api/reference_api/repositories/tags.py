"""Теги файлов: как хранятся и как достаются. Бизнес-смысла здесь нет."""

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.models.library import AssetEmbedding, AssetTag


async def replace(db: AsyncSession, digest: str, model: str, rows: list[tuple[str, str, float]]) -> None:
    """Теги файла заменяются целиком: пересчёт — это новый набор, а не
    дописывание к старому, иначе снятый тег оставался бы навсегда."""
    await db.execute(delete(AssetTag).where(AssetTag.digest == digest, AssetTag.model == model))
    db.add_all(AssetTag(digest=digest, model=model, code=c, name=n, score=s) for c, n, s in rows)
    await db.commit()


async def of(db: AsyncSession, digests: list[str], model: str) -> dict[str, list[AssetTag]]:
    rows = await db.execute(
        select(AssetTag)
        .where(AssetTag.digest.in_(digests), AssetTag.model == model)
        .order_by(AssetTag.score.desc())
    )
    out: dict[str, list[AssetTag]] = {d: [] for d in digests}
    for t in rows.scalars():
        out[t.digest].append(t)
    return out


async def vector_of(db: AsyncSession, digest: str, model: str) -> list[float] | None:
    """Вектор картинки, уже посчитанный узнаванием: второй раз модель не
    гоняется."""
    row = await db.execute(
        select(AssetEmbedding.vector).where(
            AssetEmbedding.digest == digest, AssetEmbedding.model == model, AssetEmbedding.kind == "image"
        )
    )
    v = row.scalar_one_or_none()
    return None if v is None else list(v)

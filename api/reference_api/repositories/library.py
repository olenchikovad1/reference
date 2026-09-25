"""Векторы: как хранятся и как ищутся. Бизнес-смысла здесь нет."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.models.library import AssetEmbedding


async def put(
    db: AsyncSession, digest: str, name: str, model: str, vector: list[float], kind: str = "image"
) -> None:
    """Кладёт вектор, если такого ещё нет.

    Пара «файл + модель» уникальна: пересчитывать один и тот же файл той же
    моделью незачем, а разными — обязательно, и тогда это разные строки.
    """
    found = await db.execute(
        select(AssetEmbedding).where(
            AssetEmbedding.digest == digest,
            AssetEmbedding.model == model,
            AssetEmbedding.kind == kind,
        )
    )
    if found.scalar_one_or_none() is not None:
        return
    db.add(AssetEmbedding(digest=digest, name=name, model=model, kind=kind, vector=vector))
    await db.commit()


async def similarities(
    db: AsyncSession, model: str, vector: list[float], kind: str = "image"
) -> list[tuple[str, str, float]]:
    """Похожесть на вектор у КАЖДОЙ картинки модели, по убыванию.

    Все, а не первые N: вес в поиске меряется относительно всей библиотеки,
    и по верхушке его не посчитать. Пока картинок сотни, это дёшево; на
    десятках тысяч — повод считать среднее выборкой.
    """
    distance = AssetEmbedding.vector.cosine_distance(vector)
    rows = await db.execute(
        select(AssetEmbedding.digest, AssetEmbedding.name, (1 - distance).label("similarity"))
        .where(AssetEmbedding.model == model, AssetEmbedding.kind == kind)
        .order_by(distance)
    )
    return [(r.digest, r.name, float(r.similarity)) for r in rows]


async def nearest(
    db: AsyncSession,
    model: str,
    vector: list[float],
    exclude: str,
    kind: str = "image",
    limit: int = 5,
) -> list[tuple[str, str, float]]:
    """Ближайшие по косинусу, в пределах ОДНОЙ модели.

    Ограничение по модели не оптимизация, а условие осмысленности: векторы
    разных моделей несравнимы, и смешав их, получаем поиск, который не падает,
    а молча меряет не ту похожесть.
    """
    rows = await db.execute(
        select(
            AssetEmbedding.digest,
            AssetEmbedding.name,
            (1 - AssetEmbedding.vector.cosine_distance(vector)).label("similarity"),
        )
        .where(
            AssetEmbedding.model == model,
            AssetEmbedding.kind == kind,
            AssetEmbedding.digest != exclude,
        )
        .order_by(AssetEmbedding.vector.cosine_distance(vector))
        .limit(limit)
    )
    return [(r.digest, r.name, float(r.similarity)) for r in rows]

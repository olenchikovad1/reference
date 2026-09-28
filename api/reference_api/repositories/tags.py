"""Теги файлов: как хранятся и как достаются. Бизнес-смысла здесь нет."""

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.models.library import AssetEmbedding, AssetTag, AssetWarning


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


async def replace_warnings(db: AsyncSession, digest: str, model: str, rows: list[tuple[str, str, str]]) -> None:
    """Предупреждения модели заменяются целиком, как теги: снятое не должно
    висеть навсегда."""
    await db.execute(delete(AssetWarning).where(AssetWarning.digest == digest, AssetWarning.model == model))
    db.add_all(AssetWarning(digest=digest, model=model, kind=k, code=c, text=t) for k, c, t in rows)
    await db.commit()


async def warnings_of(db: AsyncSession, digests: list[str], models: list[str]) -> dict[str, list[AssetWarning]]:
    rows = await db.execute(
        select(AssetWarning)
        .where(AssetWarning.digest.in_(digests), AssetWarning.model.in_(models))
        .order_by(AssetWarning.id)
    )
    out: dict[str, list[AssetWarning]] = {d: [] for d in digests}
    for w in rows.scalars():
        out[w.digest].append(w)
    return out


async def tagged_with(db: AsyncSession, word: str, models: list[str]) -> dict[str, str]:
    """Файлы, у которых слово — точно их тег: файл → показ тега. Сверка без
    регистра и без различия «ё» и «е»: в словаре «вертолет», человек пишет
    «вертолёт»."""
    w = word.lower().replace("ё", "е")
    rows = await db.execute(select(AssetTag.digest, AssetTag.code, AssetTag.name).where(AssetTag.model.in_(models)))
    out: dict[str, str] = {}
    for d, code, name in rows:
        if w in (code.lower().replace("ё", "е"), name.lower().replace("ё", "е")):
            out.setdefault(d, name)
    return out


async def all_models_of(db: AsyncSession, digests: list[str]) -> dict[str, dict[str, list[AssetTag]]]:
    """Теги файлов по всем моделям сразу: файл → модель → теги. Для «было»
    переразметки — у старой картинки теги прежней модели."""
    rows = await db.execute(select(AssetTag).where(AssetTag.digest.in_(digests)).order_by(AssetTag.score.desc()))
    out: dict[str, dict[str, list[AssetTag]]] = {d: {} for d in digests}
    for t in rows.scalars():
        out[t.digest].setdefault(t.model, []).append(t)
    return out


async def drop_other_models(db: AsyncSession, digest: str, keep: list[str]) -> None:
    """Теги прежних моделей у файла — вон: после переразметки они никому не
    нужны, а копились бы с каждой сменой модели."""
    await db.execute(delete(AssetTag).where(AssetTag.digest == digest, AssetTag.model.not_in(keep)))
    await db.commit()

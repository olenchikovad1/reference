"""Векторы: как хранятся и как ищутся. Бизнес-смысла здесь нет."""

from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.models.library import AssetDefect, AssetEmbedding, LibraryAudience, LibraryDrop, LibraryText


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


async def images(db: AsyncSession, model: str) -> list[tuple[str, str]]:
    """Картинки библиотеки — файлы с вектором картинки этой модели, свежие
    первыми. Лист целиком (kind=sheet) — не картинка библиотеки."""
    rows = await db.execute(
        select(AssetEmbedding.digest, AssetEmbedding.name)
        .where(AssetEmbedding.model == model, AssetEmbedding.kind == "image")
        .order_by(AssetEmbedding.id.desc())
    )
    return [(d, n) for d, n in rows]


async def planned_texts(db: AsyncSession) -> list[LibraryText]:
    rows = await db.execute(select(LibraryText).order_by(LibraryText.created_at.desc()))
    return list(rows.scalars())


async def add_text(db: AsyncSession, text: str, normalised: str, author_id: str | None) -> None:
    """Заведённая надпись; та же по нормализованному — не вторая."""
    exists = await db.scalar(select(LibraryText.id).where(LibraryText.normalised == normalised))
    if exists is None:
        db.add(LibraryText(text=text, normalised=normalised, author_id=author_id))
    await db.commit()


async def text_similarities(db: AsyncSession, query: str, texts: list[str]) -> dict[str, float]:
    """Похожесть запроса на каждую надпись — триграммами (решение 0010), одним
    запросом, той же мерой, что узнавание надписи при сохранении."""
    if not texts:
        return {}
    rows = await db.execute(
        text("select t, similarity(:q, t) from unnest(cast(:texts as text[])) as t"),
        {"q": query, "texts": texts},
    )
    return {t: float(s) for t, s in rows}


async def assigned(
    db: AsyncSession, kind: str
) -> tuple[list[tuple[str, int, str, str | None]], list[tuple[str, str]]]:
    """Назначенное руками: «ключ — дроп — статус — причина» и «ключ — адресат»."""
    drops = await db.execute(
        select(LibraryDrop.key, LibraryDrop.drop_id, LibraryDrop.status, LibraryDrop.reason)
        .where(LibraryDrop.kind == kind)
    )
    audiences = await db.execute(
        select(LibraryAudience.key, LibraryAudience.audience).where(LibraryAudience.kind == kind)
    )
    return [(k, d, s, r) for k, d, s, r in drops], [(k, a) for k, a in audiences]


async def link(
    db: AsyncSession, kind: str, keys: list[str], drop_id: int | None, audience: str | None,
    remove: bool, author_id: str | None,
) -> None:
    """Назначить (или снять) дроп либо адресат нескольким разом."""
    for key in set(keys):
        if drop_id is not None:
            found = await db.get(LibraryDrop, (kind, key, drop_id))
            # Снять можно только ещё не решённое — отзыв предложения. Решённое
            # не удаляется: «почему не взяли» спрашивают позже.
            if remove and found is not None and found.status == "proposed":
                await db.delete(found)
            elif not remove and found is None:
                db.add(LibraryDrop(kind=kind, key=key, drop_id=drop_id, author_id=author_id))
        if audience is not None:
            found = await db.get(LibraryAudience, (kind, key, audience))
            if remove and found is not None:
                await db.delete(found)
            elif not remove and found is None:
                db.add(LibraryAudience(kind=kind, key=key, audience=audience, author_id=author_id))
    await db.commit()


async def proposals(db: AsyncSession, drop_id: int) -> list[LibraryDrop]:
    """Предложенное в дроп вместе с решениями, свежие первыми."""
    rows = await db.execute(
        select(LibraryDrop).where(LibraryDrop.drop_id == drop_id).order_by(LibraryDrop.created_at.desc())
    )
    return list(rows.scalars())


async def decide(
    db: AsyncSession, kind: str, keys: list[str], drop_id: int, status: str, reason: str | None,
    decided_by: str | None, when,
) -> int:
    """Решение по предложенному: одобрен или не одобрен. Возвращает, сколько
    решено; непредложенное в этот дроп не решается — решать нечего."""
    done = 0
    for key in set(keys):
        found = await db.get(LibraryDrop, (kind, key, drop_id))
        if found is None:
            continue
        found.status, found.reason, found.decided_by, found.decided_at = status, reason, decided_by, when
        done += 1
    await db.commit()
    return done


async def defects_of(db: AsyncSession, digests: list[str]) -> dict[str, AssetDefect]:
    if not digests:
        return {}
    rows = await db.execute(select(AssetDefect).where(AssetDefect.digest.in_(digests)))
    return {d.digest: d for d in rows.scalars()}


async def all_defects(db: AsyncSession) -> dict[str, AssetDefect]:
    rows = await db.execute(select(AssetDefect))
    return {d.digest: d for d in rows.scalars()}


async def mark_defect(db: AsyncSession, digest: str, reason: str, by: str | None) -> None:
    found = await db.get(AssetDefect, digest)
    if found is None:
        db.add(AssetDefect(digest=digest, reason=reason, marked_by=by))
    else:
        found.reason, found.marked_by = reason, by
    await db.commit()


async def unmark_defect(db: AsyncSession, digest: str) -> None:
    await db.execute(delete(AssetDefect).where(AssetDefect.digest == digest))
    await db.commit()


async def forget_vectors(db: AsyncSession, digests: list[str], kind: str) -> None:
    """Векторы файлов, которых больше нет, — чтобы узнавание их не находило."""
    if digests:
        await db.execute(delete(AssetEmbedding).where(AssetEmbedding.digest.in_(digests), AssetEmbedding.kind == kind))
        await db.commit()

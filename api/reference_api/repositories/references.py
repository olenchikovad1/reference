"""Карточки референсов: как хранятся и как ищутся. Бизнес-смысла здесь нет."""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.models.references import Reference, ReferenceText


async def save(
    db: AsyncSession,
    name: str,
    sheet_digest: str,
    image_digests: list[str],
    texts: list[tuple[str, str]],
    work: dict | None = None,
    author_id: str | None = None,
) -> Reference:
    """Кладёт НОВУЮ карточку вместе с её надписями. Пути обновления нет
    вовсе (И-6): сохранить ещё раз — это новая карточка, прошлая остаётся как
    была. Надписи приходят парами «как написано, нормализовано»."""
    card = Reference(
        name=name, sheet_digest=sheet_digest, image_digests=list(image_digests), work=work,
        author_id=author_id,
    )
    card.texts = [ReferenceText(text=t, normalised=n) for t, n in texts]
    db.add(card)
    await db.commit()
    return card


async def by_image(db: AsyncSession, digests: list[str], exclude: int) -> list[Reference]:
    """Карточки, где встречается хоть одна из этих картинок."""
    if not digests:
        return []
    rows = await db.execute(
        select(Reference)
        .where(Reference.image_digests.overlap(digests), Reference.id != exclude)
        .order_by(Reference.created_at.desc())
    )
    return list(rows.scalars())


async def by_sheet(db: AsyncSession, digests: list[str], exclude: int) -> list[Reference]:
    """Карточки с такими печатными листами."""
    if not digests:
        return []
    rows = await db.execute(
        select(Reference).where(Reference.sheet_digest.in_(digests), Reference.id != exclude)
    )
    return list(rows.scalars())


async def text_exactly(
    db: AsyncSession, normalised: str, exclude: int
) -> list[tuple[Reference, ReferenceText]]:
    """Точное совпадение надписи. Сравнивается нормализованная — см. модель."""
    rows = await db.execute(
        select(Reference, ReferenceText)
        .join(ReferenceText, ReferenceText.reference_id == Reference.id)
        .where(ReferenceText.normalised == normalised, Reference.id != exclude)
        .order_by(Reference.created_at.desc())
    )
    return [(r, t) for r, t in rows]


async def text_near(
    db: AsyncSession, normalised: str, threshold: float, exclude: int, limit: int = 5
) -> list[tuple[Reference, ReferenceText, float]]:
    """Похожая надпись — триграммами (решение 0010).

    Порог передаётся параметром, а не берётся из настройки базы
    ``pg_trgm.similarity_threshold``: настройка сеансовая, и оператор ``%``
    молча мерил бы порогом, про который в коде не сказано.
    """
    score = func.similarity(ReferenceText.normalised, normalised)
    rows = await db.execute(
        select(Reference, ReferenceText, score.label("score"))
        .join(ReferenceText, ReferenceText.reference_id == Reference.id)
        .where(
            ReferenceText.normalised != normalised,
            Reference.id != exclude,
            score >= threshold,
        )
        .order_by(score.desc())
        .limit(limit)
    )
    return [(r, t, float(s)) for r, t, s in rows]


async def search(db: AsyncSession, normalised: str, limit: int = 20) -> list[Reference]:
    """Точный поиск по надписи. Именно точный — см. критерий истории."""
    rows = await db.execute(
        select(Reference)
        .join(ReferenceText, ReferenceText.reference_id == Reference.id)
        .where(ReferenceText.normalised == normalised)
        .order_by(Reference.created_at.desc())
        .limit(limit)
    )
    return list(rows.unique().scalars())


async def get(db: AsyncSession, card_id: int) -> Reference | None:
    return await db.get(Reference, card_id)


async def latest(db: AsyncSession, limit: int = 50) -> list[Reference]:
    """Свежие первыми: открывают почти всегда последнее сохранённое."""
    rows = await db.execute(
        select(Reference).order_by(Reference.created_at.desc(), Reference.id.desc()).limit(limit)
    )
    return list(rows.scalars())

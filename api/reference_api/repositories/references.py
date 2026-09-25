"""Референсы и их версии: как хранятся и как ищутся. Бизнес-смысла здесь нет.

Искать — по версиям (надписи, картинки и листы лежат в них), отдавать —
карточки: находка — референс, а не одно из его сохранений.
"""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.models.references import Reference, ReferenceText, ReferenceVersion


async def create(
    db: AsyncSession,
    name: str,
    colour_model_id: int | None = None,
    forked_from_version_id: int | None = None,
) -> Reference:
    """Новая карточка без версий: первую кладёт ``add_version`` в той же
    транзакции — карточка без версии наружу не выходит."""
    card = Reference(name=name, colour_model_id=colour_model_id, forked_from_version_id=forked_from_version_id)
    db.add(card)
    await db.flush()
    return card


async def add_version(
    db: AsyncSession,
    card: Reference,
    name: str,
    sheet_digest: str,
    image_digests: list[str],
    texts: list[tuple[str, str]],
    work: dict | None,
    author_id: str | None,
) -> ReferenceVersion:
    """Кладёт НОВУЮ версию поверх последней и фиксирует транзакцию.

    Пути обновления версии нет вовсе (И-6): правка — это следующий номер,
    прошлые остаются как были. Номер считается здесь, повтор держит уникальность
    в базе. Имя карточки становится именем последней версии. Надписи приходят
    парами «как написано, нормализовано».
    """
    last = await db.scalar(
        select(func.max(ReferenceVersion.number)).where(ReferenceVersion.reference_id == card.id)
    )
    version = ReferenceVersion(
        reference_id=card.id, number=(last or 0) + 1, sheet_digest=sheet_digest,
        image_digests=list(image_digests), work=work, author_id=author_id,
    )
    version.texts = [ReferenceText(text=t, normalised=n) for t, n in texts]
    db.add(version)
    card.name = name
    await db.commit()
    return version


async def get(db: AsyncSession, card_id: int) -> Reference | None:
    return await db.get(Reference, card_id)


async def versions(db: AsyncSession, card_id: int) -> list[ReferenceVersion]:
    """Версии референса по порядку номеров."""
    rows = await db.execute(
        select(ReferenceVersion)
        .where(ReferenceVersion.reference_id == card_id)
        .order_by(ReferenceVersion.number)
    )
    return list(rows.scalars())


async def version(db: AsyncSession, card_id: int, number: int) -> ReferenceVersion | None:
    return await db.scalar(
        select(ReferenceVersion).where(
            ReferenceVersion.reference_id == card_id, ReferenceVersion.number == number
        )
    )


async def version_by_id(db: AsyncSession, version_id: int) -> ReferenceVersion | None:
    return await db.get(ReferenceVersion, version_id)


async def by_image(
    db: AsyncSession, digests: list[str], exclude: int
) -> list[tuple[Reference, set[str]]]:
    """Карточки, где хоть в одной версии встречается хоть одна из этих
    картинок, — вместе с картинками всех таких версий. Карточка одна на
    референс: пять версий одного принта — не пять находок."""
    if not digests:
        return []
    rows = await db.execute(
        select(Reference, ReferenceVersion.image_digests)
        .join(ReferenceVersion, ReferenceVersion.reference_id == Reference.id)
        .where(ReferenceVersion.image_digests.overlap(digests), Reference.id != exclude)
        .order_by(ReferenceVersion.created_at.desc())
    )
    found: dict[int, tuple[Reference, set[str]]] = {}
    for card, images in rows:
        found.setdefault(card.id, (card, set()))[1].update(images)
    return list(found.values())


async def by_sheet(db: AsyncSession, digests: list[str], exclude: int) -> list[Reference]:
    """Карточки, у которых хоть одна версия с таким печатным листом."""
    if not digests:
        return []
    rows = await db.execute(
        select(Reference)
        .join(ReferenceVersion, ReferenceVersion.reference_id == Reference.id)
        .where(ReferenceVersion.sheet_digest.in_(digests), Reference.id != exclude)
    )
    return list(rows.unique().scalars())


async def text_exactly(
    db: AsyncSession, normalised: str, exclude: int
) -> list[tuple[Reference, ReferenceText]]:
    """Точное совпадение надписи. Сравнивается нормализованная — см. модель."""
    rows = await db.execute(
        select(Reference, ReferenceText)
        .join(ReferenceVersion, ReferenceVersion.reference_id == Reference.id)
        .join(ReferenceText, ReferenceText.version_id == ReferenceVersion.id)
        .where(ReferenceText.normalised == normalised, Reference.id != exclude)
        .order_by(ReferenceVersion.created_at.desc())
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
        .join(ReferenceVersion, ReferenceVersion.reference_id == Reference.id)
        .join(ReferenceText, ReferenceText.version_id == ReferenceVersion.id)
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
        .join(ReferenceVersion, ReferenceVersion.reference_id == Reference.id)
        .join(ReferenceText, ReferenceText.version_id == ReferenceVersion.id)
        .where(ReferenceText.normalised == normalised)
        .order_by(ReferenceVersion.created_at.desc())
        .limit(limit)
    )
    return list(rows.unique().scalars())


async def latest(db: AsyncSession, limit: int = 50) -> list[tuple[Reference, ReferenceVersion]]:
    """Карточки с последней версией, свежие по ней первыми: открывают почти
    всегда то, что сохраняли последним."""
    newest = (
        select(ReferenceVersion.reference_id, func.max(ReferenceVersion.number).label("number"))
        .group_by(ReferenceVersion.reference_id)
        .subquery()
    )
    rows = await db.execute(
        select(Reference, ReferenceVersion)
        .join(newest, newest.c.reference_id == Reference.id)
        .join(
            ReferenceVersion,
            (ReferenceVersion.reference_id == Reference.id)
            & (ReferenceVersion.number == newest.c.number),
        )
        .order_by(ReferenceVersion.created_at.desc(), ReferenceVersion.id.desc())
        .limit(limit)
    )
    return [(c, v) for c, v in rows]

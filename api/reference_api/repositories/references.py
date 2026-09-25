"""Референсы и их версии: как хранятся и как ищутся. Бизнес-смысла здесь нет.

Искать — по версиям (надписи, картинки и листы лежат в них), отдавать —
карточки: находка — референс, а не одно из его сохранений.
"""

from datetime import datetime

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.models.references import (
    Reference,
    ReferenceHiddenTag,
    ReferenceTag,
    ReferenceText,
    ReferenceVersion,
)


#: Живой — не в корзине. Удалённое не узнаётся, не ищется и не стоит на
#: витрине: иначе «удалил» значило бы «спрятал с одного экрана» (решение 0014).
ALIVE = Reference.deleted_at.is_(None)


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
    views: dict[str, str] | None = None,
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
        image_digests=list(image_digests), work=work, author_id=author_id, views=views or None,
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
        .where(ReferenceVersion.image_digests.overlap(digests), Reference.id != exclude, ALIVE)
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
        .where(ReferenceVersion.sheet_digest.in_(digests), Reference.id != exclude, ALIVE)
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
        .where(ReferenceText.normalised == normalised, Reference.id != exclude, ALIVE)
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
            ALIVE,
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
        .where(ReferenceText.normalised == normalised, ALIVE)
        .order_by(ReferenceVersion.created_at.desc())
        .limit(limit)
    )
    return list(rows.unique().scalars())


async def latest(
    db: AsyncSession, limit: int = 50, trashed: bool = False
) -> list[tuple[Reference, ReferenceVersion]]:
    """Карточки с последней версией, свежие по ней первыми: открывают почти
    всегда то, что сохраняли последним. `trashed` — корзина вместо витрины."""
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
        .where(Reference.deleted_at.is_not(None) if trashed else ALIVE)
        .order_by(ReferenceVersion.created_at.desc(), ReferenceVersion.id.desc())
        .limit(limit)
    )
    return [(c, v) for c, v in rows]


async def tags(db: AsyncSession, card_id: int) -> list[ReferenceTag]:
    rows = await db.execute(
        select(ReferenceTag).where(ReferenceTag.reference_id == card_id).order_by(ReferenceTag.created_at)
    )
    return list(rows.scalars())


async def add_tag(db: AsyncSession, card_id: int, name: str, normalised: str, author_id: str | None) -> None:
    """Свой тег; тот же по нормализованному — не второй, а тот же."""
    exists = await db.scalar(
        select(ReferenceTag.id).where(ReferenceTag.reference_id == card_id, ReferenceTag.normalised == normalised)
    )
    if exists is None:
        db.add(ReferenceTag(reference_id=card_id, name=name, normalised=normalised, author_id=author_id))
    await db.commit()


async def remove_tag(db: AsyncSession, card_id: int, normalised: str) -> None:
    await db.execute(
        delete(ReferenceTag).where(ReferenceTag.reference_id == card_id, ReferenceTag.normalised == normalised)
    )
    await db.commit()


async def hidden_tags(db: AsyncSession, card_id: int) -> list[ReferenceHiddenTag]:
    rows = await db.execute(
        select(ReferenceHiddenTag)
        .where(ReferenceHiddenTag.reference_id == card_id)
        .order_by(ReferenceHiddenTag.created_at)
    )
    return list(rows.scalars())


async def hide_tag(db: AsyncSession, card_id: int, code: str, name: str) -> None:
    if await db.get(ReferenceHiddenTag, (card_id, code)) is None:
        db.add(ReferenceHiddenTag(reference_id=card_id, code=code, name=name))
    await db.commit()


async def unhide_tag(db: AsyncSession, card_id: int, code: str) -> None:
    await db.execute(
        delete(ReferenceHiddenTag).where(ReferenceHiddenTag.reference_id == card_id, ReferenceHiddenTag.code == code)
    )
    await db.commit()


async def by_own_tag(
    db: AsyncSession, normalised: str, threshold: float, limit: int = 50
) -> list[tuple[Reference, ReferenceTag, float]]:
    """Референсы по своему тегу — триграммами по слову (решение 0010):
    «школьн» и «школьной линейки» находят «школьная линейка». Порог
    параметром — по той же причине, что у надписей."""
    score = func.word_similarity(normalised, ReferenceTag.normalised)
    rows = await db.execute(
        select(Reference, ReferenceTag, score.label("score"))
        .join(ReferenceTag, ReferenceTag.reference_id == Reference.id)
        .where(score >= threshold, ALIVE)
        .order_by(score.desc())
        .limit(limit)
    )
    return [(r, t, float(s)) for r, t, s in rows]


async def hiding(db: AsyncSession, card_ids: list[int], normalised: str, threshold: float) -> set[int]:
    """Какие из референсов скрыли автотег, похожий на запрос: по нему их
    больше не находить."""
    if not card_ids:
        return set()
    rows = await db.execute(
        select(ReferenceHiddenTag.reference_id).where(
            ReferenceHiddenTag.reference_id.in_(card_ids),
            func.word_similarity(normalised, func.lower(ReferenceHiddenTag.name)) >= threshold,
        )
    )
    return set(rows.scalars())


async def tag_names(db: AsyncSession, prefix: str, limit: int = 12) -> list[str]:
    """Уже заведённые свои теги — подсказка при вводе, частые первыми."""
    rows = await db.execute(
        select(func.min(ReferenceTag.name), func.count())
        .where(ReferenceTag.normalised.startswith(prefix))
        .group_by(ReferenceTag.normalised)
        .order_by(func.count().desc(), func.min(ReferenceTag.name))
        .limit(limit)
    )
    return [n for n, _ in rows]


async def to_trash(db: AsyncSession, card: Reference, when: datetime, by: str | None) -> None:
    card.deleted_at = when
    card.deleted_by = by
    await db.commit()


async def from_trash(db: AsyncSession, card: Reference) -> None:
    card.deleted_at = None
    card.deleted_by = None
    await db.commit()


async def erase(db: AsyncSession, card_id: int) -> None:
    """Стереть референс физически: версии с надписями, теги, саму карточку.

    Один из двух путей физического удаления (решение 0014). Файлы картинок и
    листов не трогаются — их берут другие референсы. Копии, пошедшие от его
    версий, остаются, но отметка «от какого пошла» у них пустеет: ссылаться
    больше не на что.
    """
    version_ids = select(ReferenceVersion.id).where(ReferenceVersion.reference_id == card_id)
    await db.execute(
        update(Reference).where(Reference.forked_from_version_id.in_(version_ids)).values(forked_from_version_id=None)
    )
    await db.execute(delete(ReferenceVersion).where(ReferenceVersion.reference_id == card_id))
    await db.execute(delete(Reference).where(Reference.id == card_id))
    await db.commit()


async def expired(db: AsyncSession, before: datetime) -> list[int]:
    """Номера референсов, пролежавших в корзине дольше срока."""
    rows = await db.execute(select(Reference.id).where(Reference.deleted_at < before))
    return list(rows.scalars())


async def origins(db: AsyncSession, version_ids: list[int]) -> dict[int, int]:
    """Версия → номер её референса: «от какого пошла» для списка карточек."""
    if not version_ids:
        return {}
    rows = await db.execute(
        select(ReferenceVersion.id, ReferenceVersion.reference_id).where(ReferenceVersion.id.in_(version_ids))
    )
    return {v: r for v, r in rows}


async def files_of(db: AsyncSession, card_id: int) -> set[str]:
    """Листы и снимки сторон всех версий референса."""
    out: set[str] = set()
    for v in await versions(db, card_id):
        out.add(v.sheet_digest)
        out.update((v.views or {}).values())
    return out


async def files_in_use(db: AsyncSession, digests: set[str]) -> set[str]:
    """Какие из файлов стоят хоть в одной версии как лист, снимок или картинка."""
    if not digests:
        return set()
    rows = await db.execute(select(ReferenceVersion.sheet_digest, ReferenceVersion.views, ReferenceVersion.image_digests))
    used: set[str] = set()
    for sheet, views, images in rows:
        used.add(sheet)
        used.update((views or {}).values())
        used.update(images or [])
    return used & digests

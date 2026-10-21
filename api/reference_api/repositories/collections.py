"""Разработка коллекции: варианты на базах, метки, отметки «видел».

Слой: repositories. Как данные достаются, без бизнес-смысла. Вариант — та же
карточка референса (решение 0020), поэтому версии кладёт репозиторий
референсов: путь записи версии один (И-6).
"""

from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.models.references import (
    CollectionLabel,
    Reference,
    ReferenceLabelEvent,
    ReferenceSeen,
    ReferenceVersion,
)
from reference_api.repositories import references as references_repo


async def labels(db: AsyncSession) -> list[CollectionLabel]:
    """Все метки, погашенные тоже: на старых карточках они остаются видны."""
    rows = await db.execute(select(CollectionLabel).order_by(CollectionLabel.position, CollectionLabel.id))
    return list(rows.scalars())


async def label(db: AsyncSession, label_id: int) -> CollectionLabel | None:
    return await db.get(CollectionLabel, label_id)


async def label_named(db: AsyncSession, name: str) -> CollectionLabel | None:
    return await db.scalar(select(CollectionLabel).where(func.lower(CollectionLabel.name) == name.lower()))


async def add_label(db: AsyncSession, name: str, tone: str) -> CollectionLabel:
    last = await db.scalar(select(func.max(CollectionLabel.position)))
    row = CollectionLabel(name=name, tone=tone, position=(last if last is not None else -1) + 1)
    db.add(row)
    await db.commit()
    return row


async def variants(db: AsyncSession, release_id: str) -> list[tuple[Reference, ReferenceVersion]]:
    """Живые варианты коллекции с последней версией, свежие первыми."""
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
            (ReferenceVersion.reference_id == Reference.id) & (ReferenceVersion.number == newest.c.number),
        )
        .where(Reference.plm_release_id == release_id, Reference.deleted_at.is_(None))
        .order_by(Reference.board_position.asc().nulls_last(), Reference.created_at.desc(), Reference.id.desc())
    )
    return [(card, version) for card, version in rows]


async def variant_counts(db: AsyncSession, release_ids: list[str]) -> dict[str, int]:
    if not release_ids:
        return {}
    rows = await db.execute(
        select(Reference.plm_release_id, func.count())
        .where(Reference.plm_release_id.in_(release_ids), Reference.deleted_at.is_(None))
        .group_by(Reference.plm_release_id)
    )
    return {release_id: int(count) for release_id, count in rows if release_id is not None}


def _column(release_id: str, style_id: str, colorway_id: str | None):
    """Колонка доски: цвет базы или её «Идеи» (цвета нет)."""
    colour = Reference.plm_colorway_id == colorway_id if colorway_id else Reference.plm_colorway_id.is_(None)
    return (Reference.plm_release_id == release_id, Reference.plm_style_id == style_id, colour)


async def column_size(db: AsyncSession, release_id: str, style_id: str, colorway_id: str | None) -> int:
    """Сколько вариантов уже заводили в колонке — для номера в имени."""
    return int(await db.scalar(select(func.count()).where(*_column(release_id, style_id, colorway_id))) or 0)


async def top_position(db: AsyncSession, release_id: str, style_id: str, colorway_id: str | None) -> int:
    """Место выше всех в колонке: новый вариант встаёт наверх."""
    least = await db.scalar(select(func.min(Reference.board_position)).where(*_column(release_id, style_id, colorway_id)))
    return (least if least is not None else 1) - 1


async def create_variant(
    db: AsyncSession,
    *,
    release_id: str,
    style_id: str,
    colorway_id: str | None,
    name: str,
    digest: str,
    work: dict,
    author_id: str | None,
) -> tuple[Reference, ReferenceVersion]:
    """Карточка варианта и её первая версия — одной транзакцией: версию
    кладёт и фиксирует репозиторий референсов."""
    card = Reference(
        name=name,
        executor_id=author_id,
        plm_release_id=release_id,
        plm_style_id=style_id,
        plm_colorway_id=colorway_id,
        board_position=await top_position(db, release_id, style_id, colorway_id),
    )
    db.add(card)
    await db.flush()
    version = await references_repo.add_version(db, card, name, digest, [digest], [], work, author_id)
    return card, version


async def cards(db: AsyncSession, release_id: str, ids: list[int]) -> list[Reference]:
    """Живые варианты коллекции из списка — чужие и удалённые не попадут."""
    if not ids:
        return []
    rows = await db.execute(
        select(Reference).where(
            Reference.id.in_(ids), Reference.plm_release_id == release_id, Reference.deleted_at.is_(None)
        )
    )
    return list(rows.scalars())


async def place(db: AsyncSession, ordered: list[Reference], style_id: str, colorway_id: str | None) -> None:
    """Колонка в этом порядке: перенесённые меняют базу и цвет, отложенные
    возвращаются в работу. Остальное в карточке не трогается."""
    for index, card in enumerate(ordered):
        card.plm_style_id = style_id
        card.plm_colorway_id = colorway_id
        card.board_position = index
        card.shelved_at = None
        card.shelved_by = None
    await db.commit()


async def shelve(db: AsyncSession, card: Reference, by_id: str | None) -> None:
    card.shelved_at = datetime.now(UTC)
    card.shelved_by = by_id
    await db.commit()


async def unshelve(db: AsyncSession, card: Reference) -> None:
    card.shelved_at = None
    card.shelved_by = None
    await db.commit()


async def last_label_events(db: AsyncSession, reference_ids: list[int]) -> dict[int, ReferenceLabelEvent]:
    """Последняя постановка метки у каждой карточки: кто и когда — видно на
    карточке, и чужая метка после моего прихода — «новое»."""
    if not reference_ids:
        return {}
    latest = (
        select(ReferenceLabelEvent.reference_id, func.max(ReferenceLabelEvent.id).label("id"))
        .where(ReferenceLabelEvent.reference_id.in_(reference_ids))
        .group_by(ReferenceLabelEvent.reference_id)
        .subquery()
    )
    rows = await db.execute(select(ReferenceLabelEvent).join(latest, latest.c.id == ReferenceLabelEvent.id))
    return {row.reference_id: row for row in rows.scalars()}


async def set_label(db: AsyncSession, card: Reference, label_id: int | None, by_id: str | None) -> None:
    card.label_id = label_id
    db.add(ReferenceLabelEvent(reference_id=card.id, label_id=label_id, by_id=by_id))
    await db.commit()


async def seen(db: AsyncSession, reference_ids: list[int], viewer_id: str) -> dict[int, ReferenceSeen]:
    if not reference_ids:
        return {}
    rows = await db.execute(
        select(ReferenceSeen).where(ReferenceSeen.reference_id.in_(reference_ids), ReferenceSeen.viewer_id == viewer_id)
    )
    return {row.reference_id: row for row in rows.scalars()}


async def mark_seen(db: AsyncSession, reference_id: int, viewer_id: str, number: int) -> None:
    """Запомнить, что человек видел версию. Номер только растёт: открыв
    старую версию после новой, новое «невиденным» не становится."""
    statement = insert(ReferenceSeen).values(reference_id=reference_id, viewer_id=viewer_id, number=number)
    statement = statement.on_conflict_do_update(
        index_elements=[ReferenceSeen.reference_id, ReferenceSeen.viewer_id],
        set_={"number": func.greatest(ReferenceSeen.number, statement.excluded.number), "at": func.now()},
    )
    await db.execute(statement)
    await db.commit()


async def latest_number(db: AsyncSession, reference_id: int) -> int | None:
    return await db.scalar(
        select(func.max(ReferenceVersion.number)).where(ReferenceVersion.reference_id == reference_id)
    )

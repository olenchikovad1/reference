"""Референсы и их версии: как хранятся и как ищутся. Бизнес-смысла здесь нет.

Искать — по версиям (надписи, картинки и листы лежат в них), отдавать —
карточки: находка — референс, а не одно из его сохранений.
"""

from datetime import datetime
from dataclasses import dataclass
from typing import Literal

from sqlalchemy import Float, Integer, and_, any_, case, cast, delete, exists, false, func, literal, or_, select, update
from sqlalchemy.dialects.postgresql import ARRAY, insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Load, defer
from sqlalchemy.sql.elements import ColumnElement
from sqlalchemy.sql.selectable import Select

from reference_api.models.references import (
    ReferenceTransfer,
    Reference,
    ReferenceColourExclusion,
    ReferenceDraft,
    ReferencePosition,
    ReferenceHiddenTag,
    ReferenceTag,
    ReferenceText,
    ReferenceVersion,
)
from reference_api.models.drops import ColourModel, DropItem, GarmentModel


#: Живой — не в корзине. Удалённое не узнаётся, не ищется и не стоит на
#: витрине: иначе «удалил» значило бы «спрятал с одного экрана» (решение 0014).
ALIVE = Reference.deleted_at.is_(None)


@dataclass(frozen=True)
class PageFilters:
    q: str = ""
    drop: int | None = None
    audience: str | None = None
    category: str | None = None
    status: str | None = None
    executor: str | None = None
    my_turn: bool = False
    season: Literal["in", "ending", "out"] | None = None
    only_mine: bool = False
    only_drafts: bool = False
    sort: Literal["date", "own"] = "date"


@dataclass(frozen=True)
class PageContext:
    viewer: str | None
    category_ids: tuple[int, ...] | None = None
    in_drop_ids: tuple[int, ...] = ()
    ending_drop_ids: tuple[int, ...] = ()
    turn_statuses: tuple[str, ...] = ()
    can_review: bool = False
    search_scores: tuple[tuple[int, float], ...] = ()


@dataclass(frozen=True)
class PageAnchor:
    saved_at: datetime
    version_id: int
    bucket: int = 0
    position: int = 0
    score: float = 0


@dataclass
class ReferencePage:
    rows: list[tuple[Reference, ReferenceVersion]]
    total: int
    next_anchor: PageAnchor | None


def _page_query(filters: PageFilters, context: PageContext) -> tuple[Select, list[tuple[ColumnElement, bool]]]:
    newest = (select(ReferenceVersion.reference_id, func.max(ReferenceVersion.number).label("number"))
              .group_by(ReferenceVersion.reference_id).subquery())
    pos = ReferencePosition
    bucket = case((pos.position.is_(None), 0), else_=1)
    position = func.coalesce(pos.position, 0)
    score: ColumnElement = literal(0.0)
    query = (select(Reference, ReferenceVersion)
             .join(newest, newest.c.reference_id == Reference.id)
             .join(ReferenceVersion, and_(ReferenceVersion.reference_id == Reference.id,
                                          ReferenceVersion.number == newest.c.number))
             .outerjoin(pos, and_(pos.reference_id == Reference.id, pos.author_id == (context.viewer or "")))
             .where(ALIVE, Reference.status != "rejected", Reference.plm_release_id.is_(None)))
    if filters.q:
        # Два массива — два параметра, даже когда поиск нашёл десятки тысяч:
        # гигантский CASE/IN упёрся бы в лимит параметров PostgreSQL.
        found = func.unnest(cast([i for i, _ in context.search_scores], ARRAY(Integer)),
                            cast([s for _, s in context.search_scores], ARRAY(Float)))\
            .table_valued("reference_id", "score").render_derived()
        query = query.join(found, found.c.reference_id == Reference.id)
        score = found.c.score
    if filters.drop is not None:
        query = query.where(exists(select(DropItem.drop_id).where(
            DropItem.colour_model_id == Reference.colour_model_id, DropItem.drop_id == filters.drop)))
    if context.category_ids is not None:
        query = query.where(exists(select(ColourModel.id).join(GarmentModel).where(
            ColourModel.id == Reference.colour_model_id, GarmentModel.category_id.in_(context.category_ids))))
    if filters.status:
        query = query.where(Reference.status == filters.status)
    if filters.executor:
        query = query.where(Reference.executor_id == filters.executor)
    if filters.only_mine:
        query = query.where(Reference.executor_id == context.viewer if context.viewer else false())
    if filters.only_drafts:
        query = query.where(exists(select(ReferenceDraft.id).where(
            ReferenceDraft.reference_id == Reference.id, ReferenceDraft.author_id == context.viewer))
            if context.viewer else false())
    if filters.my_turn:
        query = query.where(or_(Reference.status.in_(context.turn_statuses),
                                and_(Reference.status == "rework", Reference.executor_id == context.viewer))
                            if context.can_review and context.viewer else false())
    if filters.season:
        has_drop = exists(select(DropItem.drop_id).where(DropItem.colour_model_id == Reference.colour_model_id))
        within = exists(select(DropItem.drop_id).where(
            DropItem.colour_model_id == Reference.colour_model_id, DropItem.drop_id.in_(context.in_drop_ids)))
        ending = exists(select(DropItem.drop_id).where(
            DropItem.colour_model_id == Reference.colour_model_id, DropItem.drop_id.in_(context.ending_drop_ids)))
        # У карточек без известного окна сезон неизвестен, а не просрочен.
        in_season = or_(within, ~has_drop)
        query = query.where(~in_season if filters.season == "out" else ending if filters.season == "ending" else in_season)
    own = filters.sort == "own" and not filters.q
    keys: list[tuple[ColumnElement, bool]] = ([(bucket, False), (position, False)] if own else [])
    if filters.q:
        keys.append((score, True))
    keys.extend([(ReferenceVersion.created_at.expression, True), (ReferenceVersion.id.expression, True)])
    return query.add_columns(bucket, position, score), keys


async def page(db: AsyncSession, filters: PageFilters, context: PageContext,
               limit: int, after: PageAnchor | None = None) -> ReferencePage:
    query, keys = _page_query(filters, context)
    total = int(await db.scalar(select(func.count()).select_from(
        query.with_only_columns(Reference.id).subquery())) or 0)
    if after:
        values: list[object] = ([after.bucket, after.position] if filters.sort == "own" and not filters.q else [])
        if filters.q:
            values.append(after.score)
        values.extend([after.saved_at, after.version_id])
        terms: list[ColumnElement] = []
        same: list[ColumnElement] = []
        for (column, descending), value in zip(keys, values, strict=True):
            terms.append(and_(*same, column < value if descending else column > value))
            same.append(column == value)
        query = query.where(or_(*terms))
    query = query.options(Load(ReferenceVersion).raiseload("*"), defer(ReferenceVersion.work, raiseload=True))
    result = list((await db.execute(query.order_by(
        *(column.desc() if desc else column.asc() for column, desc in keys)).limit(limit + 1))).all())
    selected = result[:limit]
    anchor = None
    if len(result) > limit and selected:
        _, version, bucket, position, score = selected[-1]
        anchor = PageAnchor(version.created_at, version.id, int(bucket), int(position), float(score))
    return ReferencePage([(card, version) for card, version, _, _, _ in selected], total, anchor)


async def ordered_ids(db: AsyncSession, filters: PageFilters, context: PageContext) -> list[int]:
    query, keys = _page_query(filters, context)
    result = await db.scalars(query.with_only_columns(Reference.id).order_by(
        *(column.desc() if desc else column.asc() for column, desc in keys)))
    return list(result)


async def create(
    db: AsyncSession,
    name: str,
    colour_model_id: int | None = None,
    forked_from_version_id: int | None = None,
    executor_id: str | None = None,
    garment_model_id: int | None = None,
    drop_id: int | None = None,
) -> Reference:
    """Новая карточка без версий: первую кладёт ``add_version`` в той же
    транзакции — карточка без версии наружу не выходит."""
    card = Reference(
        name=name,
        colour_model_id=colour_model_id,
        forked_from_version_id=forked_from_version_id,
        executor_id=executor_id,
        garment_model_id=garment_model_id,
        drop_id=drop_id,
    )
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
    auto_reason: str | None = None,
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
        auto_reason=auto_reason,
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
        # Как витрина: брак — в своём разделе, не в поиске (US-0885).
        .where(ReferenceText.normalised == normalised, ALIVE, Reference.status != "rejected")
        .order_by(ReferenceVersion.created_at.desc())
        .limit(limit)
    )
    return list(rows.unique().scalars())



async def latest(
    db: AsyncSession, limit: int | None = None, trashed: bool = False, *, summary: bool = False
) -> list[tuple[Reference, ReferenceVersion]]:
    """Карточки с последней версией, свежие по ней первыми: открывают почти
    всегда то, что сохраняли последним. `trashed` — корзина вместо витрины.

    Предела по умолчанию нет: до 29.09 он стоял в 50, и витрина молча не
    показывала всё, что старше пятидесятой карточки (замечено на 126)."""
    newest = (
        select(ReferenceVersion.reference_id, func.max(ReferenceVersion.number).label("number"))
        .group_by(ReferenceVersion.reference_id)
        .subquery()
    )
    rows = await db.execute(
        select(Reference, ReferenceVersion)
        .options(*(
            # Витрине нужны только метаданные. work и надписи читаются
            # при открытии/поиске; их объём растёт вместе с работами GPT.
            [Load(ReferenceVersion).raiseload("*"), defer(ReferenceVersion.work, raiseload=True)]
            if summary else []
        ))
        .join(newest, newest.c.reference_id == Reference.id)
        .join(
            ReferenceVersion,
            (ReferenceVersion.reference_id == Reference.id)
            & (ReferenceVersion.number == newest.c.number),
        )
        .where(
            *(
                [Reference.deleted_at.is_not(None)]
                if trashed
                # Варианты разработки коллекции живут на её доске (решение
                # 0020): это картинки на базе, окно работы их не открывает.
                else [ALIVE, Reference.status != "rejected", Reference.plm_release_id.is_(None)]
            ),
        )
        .order_by(ReferenceVersion.created_at.desc(), ReferenceVersion.id.desc())
        .limit(limit)
    )
    return [(c, v) for c, v in rows]


async def rejected(
    db: AsyncSession, limit: int | None = None
) -> list[tuple[Reference, ReferenceVersion]]:
    """Забракованные живые карточки — раздел «Брак», не корзина (US-0885)."""
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
        .where(ALIVE, Reference.status == "rejected")
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


def _draft_key(card_id: int | None, author_id: str):
    where = ReferenceDraft.author_id == author_id
    return where & (ReferenceDraft.reference_id.is_(None) if card_id is None else ReferenceDraft.reference_id == card_id)


async def draft(db: AsyncSession, card_id: int | None, author_id: str) -> ReferenceDraft | None:
    return (await db.execute(select(ReferenceDraft).where(_draft_key(card_id, author_id)))).scalar_one_or_none()


async def put_draft(db: AsyncSession, card_id: int | None, author_id: str, work: dict, base_number: int | None) -> None:
    """Записать черновик поверх прежнего одним запросом: пишется он на каждое
    действие, и «прочитать — решить — записать» гонялось бы само с собой."""
    stmt = insert(ReferenceDraft).values(
        reference_id=card_id, author_id=author_id, work=work, base_number=base_number
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["reference_id", "author_id"] if card_id is not None else ["author_id"],
        index_where=ReferenceDraft.reference_id.is_not(None) if card_id is not None else ReferenceDraft.reference_id.is_(None),
        set_={"work": work, "base_number": base_number, "updated_at": func.now()},
    )
    await db.execute(stmt)
    await db.commit()


async def drop_draft(db: AsyncSession, card_id: int | None, author_id: str) -> None:
    """Без коммита: черновик уходит в той же транзакции, где легла версия."""
    await db.execute(delete(ReferenceDraft).where(_draft_key(card_id, author_id)))


async def drafters(db: AsyncSession, card_ids: list[int]) -> dict[int, list[str]]:
    """Кто держит несохранённое по каждой карточке."""
    if not card_ids:
        return {}
    rows = await db.execute(
        select(ReferenceDraft.reference_id, ReferenceDraft.author_id)
        .where(ReferenceDraft.reference_id.in_(card_ids))
        .order_by(ReferenceDraft.updated_at)
    )
    out: dict[int, list[str]] = {}
    for card_id, author in rows:
        if card_id is not None:  # черновик новой карточки — без номера, сюда не относится
            out.setdefault(card_id, []).append(author)
    return out


async def positions(db: AsyncSession, author_id: str, card_ids: list[int]) -> dict[int, int]:
    """Места карточек в личном порядке человека."""
    if not card_ids:
        return {}
    rows = await db.execute(
        select(ReferencePosition.reference_id, ReferencePosition.position).where(
            ReferencePosition.author_id == author_id, ReferencePosition.reference_id.in_(card_ids)
        )
    )
    return {card_id: position for card_id, position in rows}


async def set_order(db: AsyncSession, author_id: str, card_ids: list[int]) -> None:
    """Порядок целиком, одной транзакцией: перенос — это новый порядок, а
    отмена — прежний; оба приходят списком, и половина не ляжет никогда."""
    await db.execute(delete(ReferencePosition).where(ReferencePosition.author_id == author_id))
    db.add_all(
        ReferencePosition(author_id=author_id, reference_id=card_id, position=i)
        for i, card_id in enumerate(card_ids)
    )
    await db.commit()


async def alive_ids(db: AsyncSession, card_ids: list[int]) -> set[int]:
    """Какие из номеров — живые карточки, не в корзине."""
    if not card_ids:
        return set()
    # Один массив вместо отдельного bind на номер: длинный личный порядок
    # иначе упирается в предел параметров asyncpg раньше предела HTTP-схемы.
    return set((await db.execute(select(Reference.id).where(
        Reference.id == any_(cast(card_ids, ARRAY(Integer))), ALIVE))).scalars())


async def pass_to(db: AsyncSession, reference_id: int, to_id: str, by_id: str | None) -> None:
    """Сменить исполнителя и записать передачу — одной транзакцией. Карточку
    сервис уже проверил в этой же сессии."""
    card = await db.get_one(Reference, reference_id)
    db.add(ReferenceTransfer(reference_id=reference_id, from_id=card.executor_id, to_id=to_id, by_id=by_id))
    card.executor_id = to_id
    await db.commit()


async def transfers(db: AsyncSession, reference_id: int) -> list[ReferenceTransfer]:
    rows = await db.execute(select(ReferenceTransfer).where(ReferenceTransfer.reference_id == reference_id)
                            .order_by(ReferenceTransfer.at, ReferenceTransfer.id))
    return list(rows.scalars())


async def drafts_of(db: AsyncSession, author_id: str) -> list[tuple[ReferenceDraft, Reference | None]]:
    """Черновики человека с их карточками, свежие первыми (US-0685). Карточки
    в корзине не в счёт: открыть черновик к ним нельзя."""
    rows = await db.execute(
        select(ReferenceDraft, Reference)
        .outerjoin(Reference, Reference.id == ReferenceDraft.reference_id)
        .where(ReferenceDraft.author_id == author_id)
        .where(Reference.deleted_at.is_(None) | ReferenceDraft.reference_id.is_(None))
        .order_by(ReferenceDraft.updated_at.desc())
    )
    return [(d, c) for d, c in rows.all()]


async def exclusions(db: AsyncSession, reference_id: int) -> set[int]:
    rows = await db.execute(
        select(ReferenceColourExclusion.colour_model_id).where(
            ReferenceColourExclusion.reference_id == reference_id
        )
    )
    return set(rows.scalars())


async def exclude_colour(db: AsyncSession, reference_id: int, colour_model_id: int) -> None:
    exists = await db.scalar(
        select(ReferenceColourExclusion.reference_id).where(
            ReferenceColourExclusion.reference_id == reference_id,
            ReferenceColourExclusion.colour_model_id == colour_model_id,
        )
    )
    if exists is None:
        db.add(ReferenceColourExclusion(reference_id=reference_id, colour_model_id=colour_model_id))
        await db.commit()


async def include_colour(db: AsyncSession, reference_id: int, colour_model_id: int) -> None:
    await db.execute(
        delete(ReferenceColourExclusion).where(
            ReferenceColourExclusion.reference_id == reference_id,
            ReferenceColourExclusion.colour_model_id == colour_model_id,
        )
    )
    await db.commit()


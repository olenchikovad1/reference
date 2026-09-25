"""Собранный принт: сохранение и узнавание.

Три вида узнавания не сводятся в одно число и не усредняются. Вопросы у них
разные: «такой рисунок уже был», «такой слоган уже был», «такой принт уже был»,
— и выводы тоже разные, поэтому в окне они названы раздельно.
"""

import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.config import settings
from reference_api.repositories import references as repo
from reference_api.services import assets, embeddings
from reference_api.services import library

#: Вид вектора печатного листа. Лежит рядом с векторами картинок, но отдельным
#: видом: вопросы у них разные, и смешанные они дают поиск, который молча
#: меряет не то.
SHEET = "sheet"


@dataclass(frozen=True)
class Match:
    #: По чему совпало: picture — рисунок, slogan — надпись, print — лист целиком.
    by: str
    reference_id: int
    name: str
    similarity: float
    #: same — совпало точно; close — похоже, повод посмотреть.
    level: str
    text: str | None = None


def normalise(text: str) -> str:
    """Верхний регистр, схлопнутые пробелы, без крайних.

    Больше ничего: выкидывать знаки препинания значит считать «СИЛА В ПРАВДЕ» и
    «СИЛА, В ПРАВДЕ?» одним, а это решение за технолога, а не за нас.
    """
    return re.sub(r"\s+", " ", text).strip().upper()


@dataclass(frozen=True)
class Saved:
    reference_id: int
    #: Номер сохранённой версии внутри референса.
    number: int
    matches: list[Match]


class NoSuchReference(LookupError):
    """Референса или версии с таким номером нет."""


async def create(
    db: AsyncSession,
    name: str,
    sheet_digest: str,
    image_digests: list[str],
    texts: list[str],
    work: dict | None = None,
    author_id: str | None = None,
    colour_model_id: int | None = None,
    forked_from: tuple[int, int] | None = None,
    views: dict[str, str] | None = None,
) -> Saved:
    """Новый референс с первой версией — и что узналось.

    ``forked_from`` — «сохранить как»: референс и номер версии, от которой
    пошёл новый. Порядок тот же, что у картинок: сначала ищем, потом
    сохраняем. Иначе принт находит сам себя и сообщает, что он уже был.
    """
    parent_id = None
    if forked_from is not None:
        parent = await repo.version(db, *forked_from)
        if parent is None:
            raise NoSuchReference("версии, от которой сохраняют, нет")
        parent_id = parent.id
    found = await _recognise(db, sheet_digest, image_digests, texts, exclude=0)
    card = await repo.create(db, name, colour_model_id=colour_model_id, forked_from_version_id=parent_id)
    version = await _put(db, card, name, sheet_digest, image_digests, texts, work, author_id, views)
    return Saved(card.id, version.number, found)


async def add_version(
    db: AsyncSession,
    reference_id: int,
    name: str,
    sheet_digest: str,
    image_digests: list[str],
    texts: list[str],
    work: dict | None = None,
    author_id: str | None = None,
    views: dict[str, str] | None = None,
) -> Saved:
    """«Сохранить»: новая версия поверх последней, прежние не трогаются (И-6).

    Правка открытой старой версии идёт сюда же: она ложится номером после
    последней, а не на место старой. Узнавание своих версий не видит — пятая
    версия принта, узнавшая четвёртую, ни о чём не говорит.
    """
    card = await repo.get(db, reference_id)
    if card is None:
        raise NoSuchReference("референса с таким номером нет")
    found = await _recognise(db, sheet_digest, image_digests, texts, exclude=reference_id)
    version = await _put(db, card, name, sheet_digest, image_digests, texts, work, author_id, views)
    return Saved(card.id, version.number, found)


async def _put(db, card, name, sheet_digest, image_digests, texts, work, author_id, views):
    version = await repo.add_version(
        db, card, name, sheet_digest, image_digests, [(t, normalise(t)) for t in texts], work, author_id, views
    )
    # Вектор листа считается ПОСЛЕ поиска и по тому же оригиналу, что у картинок.
    content = assets.original(sheet_digest)
    if content is not None:
        emb = embeddings.embed(content)
        await library.put_vector(db, sheet_digest, name, emb, kind=SHEET)
    return version


async def _recognise(
    db: AsyncSession, sheet_digest: str, image_digests: list[str], texts: list[str], exclude: int
) -> list[Match]:
    cfg = settings()
    out: list[Match] = []

    # Лист целиком — самое сильное совпадение, поэтому первым. Свой же хеш
    # добавляется ЯВНО: поиск по вектору исключает сам себя, и точный случай
    # «тот же лист байт в байт» иначе выпадает — а он самый частый.
    same_sheets = [sheet_digest, *await library.same_as(db, sheet_digest, kind=SHEET)]
    for card in await repo.by_sheet(db, same_sheets, exclude):
        out.append(Match("print", card.id, card.name, 1.0, "same"))

    # Рисунок: и тот же файл, и та же картинка в другом файле.
    same_pictures: list[str] = []
    for digest in image_digests:
        same_pictures.append(digest)
        same_pictures.extend(await library.same_as(db, digest, kind="image"))
    seen_by_print = {m.reference_id for m in out}
    for card, _ in await repo.by_image(db, same_pictures, exclude):
        if card.id not in seen_by_print:
            out.append(Match("picture", card.id, card.name, 1.0, "same"))

    # Надпись: точное совпадение, затем похожее (решение 0010).
    for text in texts:
        n = normalise(text)
        for card, row in await repo.text_exactly(db, n, exclude):
            if card.id not in seen_by_print:
                out.append(Match("slogan", card.id, card.name, 1.0, "same", row.text))
        for card, row, score in await repo.text_near(db, n, cfg.slogan_close, exclude):
            if card.id not in seen_by_print:
                out.append(Match("slogan", card.id, card.name, score, "close", row.text))
    return out


async def search(db: AsyncSession, query: str) -> list[tuple[int, str]]:
    """Точный поиск по надписи."""
    return [(c.id, c.name) for c in await repo.search(db, normalise(query))]


@dataclass(frozen=True)
class Fork:
    """От какой версии какого референса пошёл («Сохранить как»)."""

    reference_id: int
    number: int
    name: str


async def open_card(db: AsyncSession, reference_id: int):
    """Карточка, её версии по порядку и версия, от которой пошла. None — такой нет."""
    card = await repo.get(db, reference_id)
    if card is None:
        return None
    fork = None
    if card.forked_from_version_id is not None:
        parent = await repo.version_by_id(db, card.forked_from_version_id)
        parent_card = await repo.get(db, parent.reference_id) if parent else None
        if parent and parent_card:
            fork = Fork(parent_card.id, parent.number, parent_card.name)
    return card, await repo.versions(db, reference_id), fork


async def open_version(db: AsyncSession, reference_id: int, number: int):
    """Версия с работой. None — такой нет."""
    return await repo.version(db, reference_id, number)


async def latest(db: AsyncSession):
    return await repo.latest(db)


def normalise_tag(name: str) -> str:
    """Тег для сравнения: нижний регистр, схлопнутые пробелы. Регистр тега —
    не смысл: «Зима» и «зима» — один тег."""
    return re.sub(r"\s+", " ", name).strip().lower()


@dataclass(frozen=True)
class Tags:
    own: list[str]
    #: Скрытые автотеги: код и имя.
    hidden: list[tuple[str, str]]


async def tags_of(db: AsyncSession, reference_id: int) -> Tags:
    return Tags(
        [t.name for t in await repo.tags(db, reference_id)],
        [(h.code, h.name) for h in await repo.hidden_tags(db, reference_id)],
    )


async def add_tag(db: AsyncSession, reference_id: int, name: str, author_id: str | None) -> Tags:
    if await repo.get(db, reference_id) is None:
        raise NoSuchReference("референса с таким номером нет")
    clean = re.sub(r"\s+", " ", name).strip()
    if clean:
        await repo.add_tag(db, reference_id, clean, normalise_tag(clean), author_id)
    return await tags_of(db, reference_id)


async def remove_tag(db: AsyncSession, reference_id: int, name: str) -> Tags:
    await repo.remove_tag(db, reference_id, normalise_tag(name))
    return await tags_of(db, reference_id)


async def hide_tag(db: AsyncSession, reference_id: int, code: str, name: str) -> Tags:
    """Неверный автотег скрыт у этого референса: не показывается и больше не
    находит его в поиске. Картинке он остаётся — у другой работы он верен."""
    if await repo.get(db, reference_id) is None:
        raise NoSuchReference("референса с таким номером нет")
    await repo.hide_tag(db, reference_id, code, name)
    return await tags_of(db, reference_id)


async def unhide_tag(db: AsyncSession, reference_id: int, code: str) -> Tags:
    await repo.unhide_tag(db, reference_id, code)
    return await tags_of(db, reference_id)


async def tag_names(db: AsyncSession, prefix: str) -> list[str]:
    return await repo.tag_names(db, normalise_tag(prefix))


@dataclass(frozen=True)
class FoundReference:
    reference_id: int
    name: str
    #: tag — свой тег, drop — дроп референса, slogan — надпись, picture —
    #: картинка по смыслу.
    by: str
    #: Порядок выдачи (US-0498): свой тег — 100 и выше (важнее любого
    #: автотега), дроп — 50–60, надпись дословно — 40, похожая — 20–30,
    #: картинка — её вес по библиотеке (2–5).
    rank: float
    #: Почему найдено — словами: «дроп „Новый год 2027“», «надпись С НОВЫМ
    #: ГОДОМ», «на картинке снег, вес 3.1».
    what: str | None = None
    #: Все причины по силе: референс бывает найден и по дропу, и по картинке.
    reasons: tuple[str, ...] = ()


async def find(db: AsyncSession, query: str) -> list[FoundReference]:
    """Один поиск на витрине (US-0498): свои теги, дропы, надписи, картинки —
    референсы по весу, у каждого сказано, почему найден.

    Дроп — словами, месяцами выхода и смыслом (services/drops.match_drops):
    «лето» находит «Пляжную коллекцию 2027», хотя слова «лето» в ней нет.
    Картинка — по смыслу (план 071), кроме референсов, скрывших похожий
    автотег. Референс — одной строкой, по самому сильному совпадению.
    """
    from reference_api.repositories import tags as tag_repo
    from reference_api.services import drops as drops_service
    from reference_api.services import tags as tagging

    q = normalise_tag(query)
    if not q:
        return []
    cfg = settings()
    out: dict[int, FoundReference] = {}
    why: dict[int, list[tuple[float, str]]] = {}

    def put(r: FoundReference) -> None:
        if r.reference_id not in out or out[r.reference_id].rank < r.rank:
            out[r.reference_id] = r
        said = why.setdefault(r.reference_id, [])
        if r.what and r.what not in [w for _, w in said]:
            said.append((r.rank, r.what))

    for card, tag, score in await repo.by_own_tag(db, q, cfg.tag_close):
        put(FoundReference(card.id, card.name, "tag", 100 + score, f"свой тег «{tag.name}»"))

    matched = await drops_service.match_drops(db, query)
    if matched:
        rows = await repo.latest(db, limit=10_000)
        places = await drops_service.colour_models_of(db, [c.colour_model_id for c, _ in rows if c.colour_model_id])
        for m in matched:
            for card, _ in rows:
                place = places.get(card.colour_model_id) if card.colour_model_id else None
                if place and m.drop.id in {d.id for d in place.drop_refs}:
                    put(FoundReference(card.id, card.name, "drop", 50 + 10 * m.score, m.why))

    for card in await repo.search(db, normalise(query)):
        put(FoundReference(card.id, card.name, "slogan", 40, f"надпись {normalise(query)}"))
    for card, row, score in await repo.text_near(db, normalise(query), cfg.slogan_close, exclude=0):
        put(FoundReference(card.id, card.name, "slogan", 20 + 10 * score, f"надпись {row.text} — похожа"))

    pictures = await library.search(db, query)
    shown = {c.id for f in pictures for c in f.references}
    hidden = await repo.hiding(db, sorted(shown), q, cfg.tag_close)
    stored = await tag_repo.of(db, [f.digest for f in pictures], tagging.model_name()) if pictures else {}
    for f in pictures:
        # Причина — тег картинки, совпавший с запросом по основе слова; нет
        # такого — сама картинка: модель нашла её по смыслу, а не по тегу.
        tag = next((r for r in stored.get(f.digest, []) if drops_service.words_meet(q, r.name)), None)
        seen = f"на картинке {tag.name}" if tag else f"картинка «{f.name}»"
        for card in f.references:
            if card.id not in hidden:
                put(FoundReference(card.id, card.name, "picture", f.weight, f"{seen}, вес {f.weight:.1f}"))
    return sorted(
        (FoundReference(r.reference_id, r.name, r.by, r.rank, r.what,
                        tuple(w for _, w in sorted(why[r.reference_id], key=lambda x: -x[0])))
         for r in out.values()),
        key=lambda r: -r.rank,
    )


class NotInTrash(Exception):
    """Стереть можно только лежащее в корзине: живой референс сначала туда."""


async def copy(db: AsyncSession, reference_id: int, author_id: str | None) -> Saved:
    """«Копировать» с витрины: новый референс, первая версия — последняя
    версия исходного как есть, с отметкой, от какого пошёл. Без открытия и без
    узнавания: копия заведомо «уже была», это и есть её смысл."""
    card = await repo.get(db, reference_id)
    if card is None:
        raise NoSuchReference("референса с таким номером нет")
    last = (await repo.versions(db, reference_id))[-1]
    new = await repo.create(db, card.name, colour_model_id=card.colour_model_id, forked_from_version_id=last.id)
    version = await repo.add_version(
        db, new, card.name, last.sheet_digest, list(last.image_digests),
        [(t.text, t.normalised) for t in last.texts], last.work, author_id, last.views,
    )
    return Saved(new.id, version.number, [])


async def trash(db: AsyncSession, reference_id: int, by: str | None) -> None:
    """В корзину — одинаково для всех референсов, согласованных тоже (0014)."""
    card = await repo.get(db, reference_id)
    if card is None:
        raise NoSuchReference("референса с таким номером нет")
    if card.deleted_at is None:
        await repo.to_trash(db, card, datetime.now(UTC), by)


async def restore(db: AsyncSession, reference_id: int) -> None:
    """Из корзины — целиком, со всей историей: версии не трогались."""
    card = await repo.get(db, reference_id)
    if card is None:
        raise NoSuchReference("референса с таким номером нет")
    if card.deleted_at is not None:
        await repo.from_trash(db, card)


async def erase(db: AsyncSession, reference_id: int) -> None:
    """«Удалить насовсем» из корзины. Живой референс так не стирается —
    сначала корзина: второго, быстрого пути нет (решение 0014)."""
    card = await repo.get(db, reference_id)
    if card is None:
        raise NoSuchReference("референса с таким номером нет")
    if card.deleted_at is None:
        raise NotInTrash("референс не в корзине — сначала удалите его в корзину")
    await repo.erase(db, reference_id)


def purge_date(deleted_at: datetime) -> datetime:
    """Когда удалённое сотрётся само."""
    return deleted_at + timedelta(days=settings().trash_days)


async def purge_expired(db: AsyncSession, now: datetime | None = None) -> int:
    """Стереть пролежавшее в корзине дольше срока. Возвращает, сколько."""
    now = now or datetime.now(UTC)
    ids = await repo.expired(db, now - timedelta(days=settings().trash_days))
    for reference_id in ids:
        await repo.erase(db, reference_id)
    return len(ids)


async def trashed(db: AsyncSession):
    return await repo.latest(db, trashed=True)


async def origins(db: AsyncSession, cards) -> dict[int, int]:
    """Референс → номер того, от чьей версии он пошёл."""
    by_version = await repo.origins(db, [c.forked_from_version_id for c in cards if c.forked_from_version_id])
    return {c.id: by_version[c.forked_from_version_id] for c in cards if c.forked_from_version_id in by_version}

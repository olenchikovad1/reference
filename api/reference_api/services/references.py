"""Собранный принт: сохранение и узнавание.

Три вида узнавания не сводятся в одно число и не усредняются. Вопросы у них
разные: «такой рисунок уже был», «такой слоган уже был», «такой принт уже был»,
— и выводы тоже разные, поэтому в окне они названы раздельно.
"""

import re
from dataclasses import dataclass

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

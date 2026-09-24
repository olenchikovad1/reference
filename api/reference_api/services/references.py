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


async def save(
    db: AsyncSession,
    name: str,
    sheet_digest: str,
    image_digests: list[str],
    texts: list[str],
    work: dict | None = None,
) -> tuple[int, list[Match]]:
    """Сохраняет собранный принт и говорит, что узналось.

    Порядок тот же, что у картинок: сначала ищем, потом сохраняем. Иначе принт
    находит сам себя и сообщает, что он уже был.
    """
    found = await _recognise(db, sheet_digest, image_digests, texts, exclude=0)
    card = await repo.save(
        db, name, sheet_digest, image_digests, [(t, normalise(t)) for t in texts], work
    )

    # Вектор листа считается ПОСЛЕ поиска и по тому же оригиналу, что у картинок.
    content = assets.original(sheet_digest)
    if content is not None:
        emb = embeddings.embed(content)
        await library.put_vector(db, sheet_digest, name, emb, kind=SHEET)
    return card.id, found


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
    for card in await repo.by_image(db, same_pictures, exclude):
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


async def open_card(db: AsyncSession, card_id: int):
    """Карточка с её работой. None — такой нет."""
    return await repo.get(db, card_id)


async def latest(db: AsyncSession):
    return await repo.latest(db)

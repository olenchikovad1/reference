"""Библиотека: правила узнавания.

Окно показывается ТОЛЬКО если нашлось. Не нашлось — не показывается ничего:
окно «совпадений нет» превращает подсказку в помеху, и его перестают читать.
"""

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

import statistics

from reference_api.config import settings
from reference_api.models.references import Reference
from reference_api.repositories import library as repo
from reference_api.repositories import references as cards
from reference_api.services import embeddings, words


@dataclass(frozen=True)
class Match:
    digest: str
    name: str
    similarity: float
    #: same — та же картинка; close — похожая по теме.
    level: str


async def remember(
    db: AsyncSession, digest: str, name: str, content: bytes
) -> tuple[list[Match], embeddings.Embedding]:
    """Считает вектор, ищет похожее и запоминает.

    Порядок важен: сначала ищем, потом запоминаем. Иначе файл найдёт сам себя.
    Вектор отдаётся наружу: из него же считаются теги, второй раз модель
    гонять незачем.
    """
    emb = embeddings.embed(content)
    found = await repo.nearest(db, emb.model, emb.vector, exclude=digest)
    await repo.put(db, digest, name, emb.model, emb.vector)

    cfg = settings()
    out: list[Match] = []
    for d, n, s in found:
        if s >= cfg.similarity_same:
            out.append(Match(d, n, s, "same"))
        elif s >= cfg.similarity_close:
            out.append(Match(d, n, s, "close"))
    return out, emb


async def put_vector(
    db: AsyncSession, digest: str, name: str, emb: embeddings.Embedding, kind: str
) -> None:
    """Кладёт готовый вектор нужного вида. Считать заново незачем."""
    await repo.put(db, digest, name, emb.model, emb.vector, kind=kind)


async def same_as(db: AsyncSession, digest: str, kind: str) -> list[str]:
    """Файлы, которые это же изображение, но другой файл.

    Тот же файл сюда не входит: его ловит хеш, и вторая сеть нужна ровно для
    того, что первая пропускает.
    """
    content = None
    from reference_api.services import assets

    content = assets.original(digest)
    if content is None:
        return []
    emb = embeddings.embed(content)
    found = await repo.nearest(db, emb.model, emb.vector, exclude=digest, kind=kind)
    cfg = settings()
    return [d for d, _, s in found if s >= cfg.similarity_same]


@dataclass(frozen=True)
class Found:
    digest: str
    name: str
    similarity: float
    #: Насколько картинка про запрос относительно остальных — в стандартных
    #: отклонениях от среднего по библиотеке. Его и видит человек.
    weight: float
    references: list[Reference]


async def search(db: AsyncSession, query: str) -> list[Found]:
    """Картинки по смыслу слова, по весу, с карточками, где они стоят.

    Пусто — не ошибка: если ни одна картинка не набрала веса, «ничего не
    нашлось» честнее, чем показать слабую догадку первой строкой.
    """
    cfg = settings()
    vector = words.embed([cfg.search_template.format(query)])[0].tolist()
    rows = await repo.similarities(db, embeddings.MODEL_NAME, vector)
    if len(rows) < 2:
        return []
    sims = [s for _, _, s in rows]
    mean, spread = statistics.fmean(sims), statistics.pstdev(sims)
    if spread == 0:
        return []
    weighed = [(d, n, s, (s - mean) / spread) for d, n, s in rows]
    if weighed[0][3] < cfg.search_min_weight:
        return []
    shown = [r for r in weighed if r[3] >= cfg.search_show_weight][: cfg.search_limit]
    used = await cards.by_image(db, [d for d, *_ in shown], exclude=0)
    return [
        Found(d, n, s, w, [c for c in used if d in c.image_digests])
        for d, n, s, w in shown
    ]

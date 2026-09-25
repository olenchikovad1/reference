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
from reference_api.repositories import tags as tag_repo
from reference_api.services import embeddings, words
from reference_api.services import names as naming
from reference_api.services import tags as tagging


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
        Found(d, n, s, w, [c for c, images in used if d in images])
        for d, n, s, w in shown
    ]


@dataclass(frozen=True)
class TagView:
    code: str
    name: str
    score: float
    #: Сильный — граница из весов тем же правилом, что при постановке.
    strong: bool
    model: str


@dataclass(frozen=True)
class FileTags:
    digest: str
    tags: list[TagView]
    #: Что за изделие на картинке — из каталога или от той же картинки; нет —
    #: никто не знает.
    name: naming.Name | None


async def put_tags(db: AsyncSession, digest: str, vector) -> list:
    """Теги картинки по её вектору — записать и вернуть. Модель второй раз не
    нужна: картинку уже посмотрели, когда считали вектор."""
    found = tagging.tag(vector)
    await tag_repo.replace(db, digest, tagging.model_name(), [(x.code, x.name, x.score) for x in found])
    return found


async def tags_of_files(db: AsyncSession, digests: list[str]) -> list[FileTags]:
    """Теги файлов. Нет — досчитываются по уже лежащему вектору; нет и вектора
    — у файла пусто, пока его не узнавали.

    Хранятся веса, а не пометка «сильный»: граница считается из весов тем же
    правилом, что при постановке, и смена доли не требует пересчёта тегов.
    """
    model = tagging.model_name()
    stored = await tag_repo.of(db, digests, model)
    named = await naming.stored(db, digests)
    out: list[FileTags] = []
    for d in digests:
        rows = stored.get(d, [])
        if not rows:
            vec = await tag_repo.vector_of(db, d, embeddings.MODEL_NAME)
            if vec is not None:
                found = tagging.tag(vec)
                await tag_repo.replace(db, d, model, [(x.code, x.name, x.score) for x in found])
                rows = (await tag_repo.of(db, [d], model))[d]
        strong = tagging.strong_of([r.score for r in rows])
        out.append(FileTags(
            d,
            [TagView(r.code, r.name, r.score, st, r.model) for r, st in zip(rows, strong, strict=True)],
            named.get(d),
        ))
    return out


@dataclass(frozen=True)
class LibraryItem:
    digest: str
    #: Имя последнего загруженного файла с таким содержимым.
    file_name: str
    tags: FileTags
    #: Референсы, где картинка стоит, — «где использован». Удалённые в корзину
    #: сюда не попадают (решение 0014).
    references: list[Reference]


async def catalogue(db: AsyncSession) -> list[LibraryItem]:
    """Библиотека целиком: картинки, свежие первыми, с тегами, названием и
    референсами, где стоят. Одна картинка в десятке референсов — одна плитка."""
    files = await repo.images(db, embeddings.MODEL_NAME)
    digests = [d for d, _ in files]
    tags = {t.digest: t for t in await tags_of_files(db, digests)}
    used = await cards.by_image(db, digests, exclude=0)
    return [
        LibraryItem(d, n, tags[d], [c for c, images in used if d in images])
        for d, n in files
    ]

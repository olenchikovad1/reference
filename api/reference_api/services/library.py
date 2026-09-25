"""Библиотека: правила узнавания.

Окно показывается ТОЛЬКО если нашлось. Не нашлось — не показывается ничего:
окно «совпадений нет» превращает подсказку в помеху, и его перестают читать.
"""

import re
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
    links: "Links"


async def catalogue(db: AsyncSession) -> list[LibraryItem]:
    """Библиотека целиком: картинки, свежие первыми, с тегами, названием и
    референсами, где стоят. Одна картинка в десятке референсов — одна плитка."""
    files = await repo.images(db, embeddings.MODEL_NAME)
    digests = [d for d, _ in files]
    tags = {t.digest: t for t in await tags_of_files(db, digests)}
    used = await cards.by_image(db, digests, exclude=0)
    linked = await links(db, "image")
    return [
        LibraryItem(d, n, tags[d], [c for c, images in used if d in images], linked.get(d) or Links({}, {}, set()))
        for d, n in files
    ]


@dataclass
class TextRow:
    """Надпись на странице «Тексты»: написание, шрифты, где стоит."""

    text: str
    normalised: str
    fonts: set[str]
    #: Номер референса → имя: «в скольких референсах» и переход к ним.
    references: dict[int, str]
    #: Заведена заранее, в референсах её ещё нет.
    planned: bool = False
    #: При поиске: same — дословно, words — все слова запроса есть в
    #: надписи, close — похоже триграммами (решение 0010).
    match: str | None = None
    similarity: float | None = None
    links: "Links | None" = None


def _normalise_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().upper()


async def texts(db: AsyncSession, query: str | None = None) -> list[TextRow]:
    """Надписи из последних версий живых референсов и заведённые заранее.

    Шрифты берутся из работы версии — надпись в двух референсах бывает двумя
    шрифтами, и видеть это надо до того, как взять её третий раз. С запросом —
    поиск по словам: дословно, по всем словам, похожее с отметкой.
    """
    rows: dict[str, TextRow] = {}
    for card, version in await cards.latest(db, limit=10_000):
        elements = ((version.work or {}).get("composition") or {}).get("elements") or []
        fonts: dict[str, set[str]] = {}
        for el in elements:
            if el.get("kind") == "text" and el.get("fontFamily"):
                fonts.setdefault(_normalise_text(el.get("text", "")), set()).add(el["fontFamily"])
        for t in version.texts:
            row = rows.setdefault(t.normalised, TextRow(t.text, t.normalised, set(), {}))
            row.references[card.id] = card.name
            row.fonts |= fonts.get(t.normalised, set())
    for planned in await repo.planned_texts(db):
        rows.setdefault(planned.normalised, TextRow(planned.text, planned.normalised, set(), {}, planned=True))
    linked = await links(db, "text")
    for n, row in rows.items():
        row.links = linked.get(n) or Links({}, {}, set())

    if not query or not query.strip():
        return sorted(rows.values(), key=lambda r: (-len(r.references), r.normalised))

    q = _normalise_text(query)
    words = q.split(" ")
    close = await repo.text_similarities(db, q, list(rows))
    found: list[TextRow] = []
    for n, row in rows.items():
        if n == q:
            row.match, row.similarity = "same", 1.0
        elif all(w in n.split(" ") for w in words):
            row.match, row.similarity = "words", close.get(n, 0.0)
        elif close.get(n, 0.0) >= settings().slogan_close:
            row.match, row.similarity = "close", close[n]
        else:
            continue
        found.append(row)
    order = {"same": 0, "words": 1, "close": 2}
    return sorted(found, key=lambda r: (order[r.match or "close"], -(r.similarity or 0), r.normalised))


async def plan_text(db: AsyncSession, text: str, author_id: str | None) -> None:
    """Завести надпись заранее — под будущий дроп."""
    clean = re.sub(r"\s+", " ", text).strip()
    if clean:
        await repo.add_text(db, clean, _normalise_text(clean), author_id)


@dataclass(frozen=True)
class DropLink:
    id: int
    name: str
    retired: bool
    #: None — назначен руками; номер — «через референс №…».
    via: int | None


@dataclass
class Links:
    """К каким дропам и адресатам относится принт или надпись, и откуда это."""

    drops: dict[int, DropLink]
    #: Адресат → None (назначен) или номер референса, через который.
    audiences: dict[str, int | None]
    #: Виды одежды — через референсы: у самого принта вида одежды нет.
    categories: set[str]


async def links(db: AsyncSession, kind: str) -> dict[str, Links]:
    """Связи с дропами и адресатом по ключам — хешу картинки или надписи.

    «Через референс» считается из живых референсов их последней версией: удалён
    или в корзине — связи через него нет, и назначать руками ради этого не
    надо. Назначенное руками главнее: оно не уходит ни с каким референсом.
    """
    from reference_api.services import drops as drops_service

    out: dict[str, Links] = {}
    rows = await cards.latest(db, limit=10_000)
    places = await drops_service.colour_models_of(db, [c.colour_model_id for c, _ in rows if c.colour_model_id])
    for card, version in rows:
        place = places.get(card.colour_model_id) if card.colour_model_id else None
        if place is None:
            continue
        keys = version.image_digests if kind == "image" else [t.normalised for t in version.texts]
        for key in set(keys):
            got = out.setdefault(key, Links({}, {}, set()))
            for d in place.drop_refs:
                got.drops.setdefault(d.id, DropLink(d.id, d.name, d.retired, card.id))
            got.audiences.setdefault(place.audience, card.id)
            if place.category:
                got.categories.add(place.category)
    assigned_drops, assigned_audiences = await repo.assigned(db, kind)
    by_id = {d.id: d for d in await drops_service.drops(db)}
    for key, drop_id in assigned_drops:
        d = by_id[drop_id]
        out.setdefault(key, Links({}, {}, set())).drops[drop_id] = DropLink(d.id, d.name, d.retired, None)
    for key, audience in assigned_audiences:
        out.setdefault(key, Links({}, {}, set())).audiences[audience] = None
    return out


class BadLink(ValueError):
    """Назначение не сходится: ни дропа, ни адресата, или адресат незнакомый."""


async def link(
    db: AsyncSession, kind: str, keys: list[str], drop_id: int | None, audience: str | None,
    remove: bool, author_id: str | None,
) -> None:
    """Назначить дроп или адресат нескольким принтам (надписям) разом."""
    from reference_api.models.drops import AUDIENCES
    from reference_api.services import drops as drops_service

    if (drop_id is None) == (audience is None):
        raise BadLink("назначается либо дроп, либо адресат")
    if audience is not None and audience not in AUDIENCES:
        raise BadLink(f"незнакомый адресат {audience}")
    if drop_id is not None and not remove:
        try:
            await drops_service.check_drop_for_linking(db, drop_id)
        except drops_service.DropNotFound:
            raise BadLink("такого дропа нет") from None
        except drops_service.CannotWork as refusal:
            raise BadLink(str(refusal)) from None
    keys = [(_normalise_text(k) if kind == "text" else k) for k in keys if k.strip()]
    await repo.link(db, kind, keys, drop_id, audience, remove, author_id)

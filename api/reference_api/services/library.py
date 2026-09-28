"""Библиотека: правила узнавания.

Окно показывается ТОЛЬКО если нашлось. Не нашлось — не показывается ничего:
окно «совпадений нет» превращает подсказку в помеху, и его перестают читать.
"""

import re
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

import statistics

from reference_api.config import settings
from reference_api.models.references import Reference
from reference_api.repositories import library as repo
from reference_api.repositories import references as cards
from reference_api.repositories import tags as tag_repo
from reference_api.services import anime, embeddings, kinds, words
from reference_api.services import assets as files
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
    #: Почему найдена: «тег «танк»» — слово запроса точно её тег; нет —
    #: найдена по самой картинке, по смыслу слова.
    because: str | None = None


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
    # Забракованное в выдаче не показывается (US-0499): оно видно только
    # фильтром «брак» на странице принтов.
    marked = await repo.all_defects(db)
    weighed = [r for r in weighed if r[0] not in marked]
    # Точное слово тега — выше любого похожего по смыслу (US-0628): картинка с
    # тегом «танк» на запрос «танк» идёт первой и показывается, даже если по
    # самой картинке её вес ниже порогов: тег поставлен — значит, про неё.
    exact = await tag_repo.tagged_with(db, query, [tagging.model_name(), anime.model_name()])
    by_tag = [r for r in weighed if r[0] in exact]
    # Порог «нашлось» — про выдачу по картинке. Не прошла она его — по
    # картинке не показывается ничего, даже если нашёлся точный тег: иначе
    # тег открывал бы дорогу слабым картинкам, которые порог и отсекал.
    image_found = bool(weighed) and weighed[0][3] >= cfg.search_min_weight
    if not by_tag and not image_found:
        return []
    rest = [r for r in weighed if image_found and r[0] not in exact and r[3] >= cfg.search_show_weight]
    shown = [(r, f"тег «{exact[r[0]]}»") for r in by_tag] + [(r, None) for r in rest]
    shown = shown[: max(cfg.search_limit, len(by_tag))]
    used = await cards.by_image(db, [r[0] for r, _ in shown], exclude=0)
    return [
        Found(d, n, s, w, [c for c, images in used if d in images], why)
        for (d, n, s, w), why in shown
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
class Warning:
    #: character — похоже на чужого персонажа; adult — взрослое.
    kind: str
    text: str


@dataclass(frozen=True)
class FileTags:
    digest: str
    tags: list[TagView]
    #: Что за изделие на картинке — из каталога или от той же картинки; нет —
    #: никто не знает.
    name: naming.Name | None
    warnings: list[Warning] = field(default_factory=list)


#: Тег вида у аниме-разметки: «аниме» ставит маршрутизатор, а не модель, но
#: ищут по нему так же, как по тегу.
_KIND_TAG = ("kind:anime", "аниме", 1.0)


def _adult_text(reasons: list[str]) -> str:
    return "похоже на взрослое или откровенное — принты детские, проверьте"


async def _run_taggers(db: AsyncSession, digest: str, vector, verdict: kinds.Verdict) -> None:
    """Разметка теми моделями, которые назвал маршрутизатор; модели, которых
    он не назвал, свои теги у файла теряют — иначе поправка вида рукой
    оставила бы старые теги рядом с новыми."""
    use = kinds.taggers(verdict)
    general = tagging.tag(vector) if "general" in use else []
    await tag_repo.replace(db, digest, tagging.model_name(), [(x.code, x.name, x.score) for x in general])
    rows: list[tuple[str, str, float]] = []
    warnings: list[tuple[str, str, str]] = []
    if "anime" in use:
        content = files.original(digest)
        if content is not None:
            r = anime.tag(content)
            rows = [_KIND_TAG, *[(t.code, t.name, t.score) for t in r.tags]]
            warnings = [("character", c, anime.character_warning(c)) for c, _ in r.characters]
            if r.adult:
                warnings.append(("adult", ",".join(r.adult), _adult_text(r.adult)))
    await tag_repo.replace(db, digest, anime.model_name(), rows)
    await tag_repo.replace_warnings(db, digest, anime.model_name(), warnings)


async def put_tags(db: AsyncSession, digest: str, vector) -> "FileTags":
    """Теги картинки — записать и вернуть. Модель выбирает вид (kinds): аниме
    — аниме-разметчик по самой картинке, остальное — общая модель по уже
    посчитанному вектору; неуверенная — обе."""
    verdict = (await kinds_of_files(db, [digest])).get(digest) or await put_kind(db, digest, vector)
    await _run_taggers(db, digest, vector, verdict)
    return (await tags_of_files(db, [digest]))[0]


def _verdict(row) -> kinds.Verdict:
    return kinds.Verdict(row.kind, row.second, row.gap, row.manual)


async def put_kind(db: AsyncSession, digest: str, vector) -> kinds.Verdict:
    """Вид картинки по её вектору — записать и вернуть. Поправка рукой, если
    была, остаётся в силе."""
    v = kinds.classify(vector)
    row = await repo.put_kind(db, digest, kinds.ROUTER_NAME, v.kind, v.second, v.gap)
    return _verdict(row)


async def kinds_of_files(db: AsyncSession, digests: list[str]) -> dict[str, kinds.Verdict]:
    """Вид файлов. Нет или посчитан прежним маршрутизатором — пересчёт по уже
    лежащему вектору; нет и вектора — вида нет, пока файл не узнавали."""
    stored = await repo.kinds_of(db, digests)
    out: dict[str, kinds.Verdict] = {}
    for d in digests:
        row = stored.get(d)
        if row is None or row.model != kinds.ROUTER_NAME:
            vec = await tag_repo.vector_of(db, d, embeddings.MODEL_NAME)
            if vec is None:
                continue
            out[d] = await put_kind(db, d, vec)
        else:
            out[d] = _verdict(row)
    return out


async def set_kind(db: AsyncSession, digest: str, kind: str, by: str | None) -> tuple[kinds.Verdict, FileTags] | None:
    """Вид рукой — и переразметка моделью этого вида. Нет вектора — картинку
    не узнавали, и размечать её нечем: None."""
    vec = await tag_repo.vector_of(db, digest, embeddings.MODEL_NAME)
    if vec is None:
        return None
    await kinds_of_files(db, [digest])
    row = await repo.set_manual_kind(db, digest, kind, by)
    await _run_taggers(db, digest, vec, _verdict(row))
    return _verdict(row), (await tags_of_files(db, [digest]))[0]


async def tags_of_files(db: AsyncSession, digests: list[str]) -> list[FileTags]:
    """Теги файлов — от тех моделей, что назвал маршрутизатор. Нет ни одного
    тега — досчитываются по уже лежащему вектору; нет и вектора — у файла
    пусто, пока его не узнавали.

    Хранятся веса, а не пометка «сильный»: у общей модели граница считается
    из весов тем же правилом, что при постановке; у аниме-модели хранятся
    только теги выше её порога, и сильные — первые десять.
    """
    general_model, anime_model = tagging.model_name(), anime.model_name()
    general = await tag_repo.of(db, digests, general_model)
    anime_rows = await tag_repo.of(db, digests, anime_model)
    warned = await tag_repo.warnings_of(db, digests, [anime_model])
    named = await naming.stored(db, digests)
    verdicts = await kinds_of_files(db, digests)
    out: list[FileTags] = []
    for d in digests:
        if not general.get(d) and not anime_rows.get(d) and d in verdicts:
            vec = await tag_repo.vector_of(db, d, embeddings.MODEL_NAME)
            if vec is not None:
                await _run_taggers(db, d, vec, verdicts[d])
                general[d] = (await tag_repo.of(db, [d], general_model))[d]
                anime_rows[d] = (await tag_repo.of(db, [d], anime_model))[d]
                warned[d] = (await tag_repo.warnings_of(db, [d], [anime_model]))[d]
        a = anime_rows.get(d, [])
        g = general.get(d, [])
        views = [TagView(r.code, r.name, r.score, i < tagging.STRONG_MAX, r.model) for i, r in enumerate(a)]
        views += [TagView(r.code, r.name, r.score, st, r.model)
                  for r, st in zip(g, tagging.strong_of([r.score for r in g]), strict=True)]
        out.append(FileTags(d, views, named.get(d), [Warning(w.kind, w.text) for w in warned.get(d, [])]))
    return out


@dataclass(frozen=True)
class LibraryItem:
    digest: str
    #: Имя последнего загруженного файла с таким содержимым.
    file_name: str
    tags: FileTags
    #: Вид картинки; нет — файл не узнавали.
    kind: "kinds.Verdict | None"
    #: Референсы, где картинка стоит, — «где использован». Удалённые в корзину
    #: сюда не попадают (решение 0014).
    references: list[Reference]
    links: "Links"
    defect: "Defect | None" = None


async def catalogue(db: AsyncSession, defects: bool = False) -> list[LibraryItem]:
    """Библиотека целиком: картинки, свежие первыми, с тегами, названием и
    референсами, где стоят. Одна картинка в десятке референсов — одна плитка."""
    files = await repo.images(db, embeddings.MODEL_NAME)
    # По умолчанию брака нет, фильтром «брак» — только он.
    marked = await repo.all_defects(db)
    files = [(d, n) for d, n in files if (d in marked) == defects]
    digests = [d for d, _ in files]
    tags = {t.digest: t for t in await tags_of_files(db, digests)}
    kind_of = await kinds_of_files(db, digests)
    used = await cards.by_image(db, digests, exclude=0)
    linked = await links(db, "image")
    return [
        LibraryItem(
            d, n, tags[d], kind_of.get(d), [c for c, images in used if d in images], linked.get(d) or Links({}, {}, set()),
            Defect(marked[d].digest, marked[d].reason, marked[d].marked_by, marked[d].marked_at) if d in marked else None,
        )
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
    #: None — предложен руками; номер — «через референс №…».
    via: int | None
    #: У предложенного — proposed, approved, rejected; у «через референс» пусто.
    status: str | None = None
    reason: str | None = None


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
    for key, drop_id, status, reason in assigned_drops:
        d = by_id[drop_id]
        out.setdefault(key, Links({}, {}, set())).drops[drop_id] = DropLink(
            d.id, d.name, d.retired, None, status, reason)
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


@dataclass(frozen=True)
class BoardItem:
    """Предложенное в дроп: что, кем, в каком статусе и почему."""

    kind: str
    key: str
    #: Как показать: имя картинки или написание надписи.
    title: str
    status: str
    proposed_by: str | None
    proposed_at: datetime
    decided_by: str | None
    decided_at: datetime | None
    reason: str | None


@dataclass(frozen=True)
class ViaReference:
    """Попавшее в дроп через референс: одобрения само не получает (US-0506)."""

    kind: str
    key: str
    title: str
    references: list[int]


async def board(db: AsyncSession, drop_id: int) -> tuple[list[BoardItem], list[ViaReference]]:
    """Доска дропа: предложенное с решениями и отдельно — то, что стоит в
    референсах дропа, но не предлагалось."""
    names = dict(await repo.images(db, embeddings.MODEL_NAME))
    named = await naming.stored(db, list(names))
    texts_by_key = {r.normalised: r.text for r in await texts(db)}

    def title(kind: str, key: str) -> str:
        if kind == "text":
            return texts_by_key.get(key, key)
        n = named.get(key)
        return n.name if n else names.get(key, key[:12])

    marked = await repo.all_defects(db)
    items = [
        BoardItem(p.kind, p.key, title(p.kind, p.key), p.status, p.author_id, p.created_at,
                  p.decided_by, p.decided_at, p.reason)
        for p in await repo.proposals(db, drop_id)
        # Забракованное в дропах не показывается (US-0499).
        if not (p.kind == "image" and p.key in marked)
    ]
    proposed = {(i.kind, i.key) for i in items}
    via: list[ViaReference] = []
    for kind in ("image", "text"):
        for key, got in (await links(db, kind)).items():
            d = got.drops.get(drop_id)
            if d is None or d.via is None or (kind, key) in proposed:
                continue
            via.append(ViaReference(kind, key, title(kind, key), [d.via]))
    return items, via


class BadDecision(ValueError):
    """Решение не сходится: незнакомый статус или отказ без причины."""


async def decide(
    db: AsyncSession, drop_id: int, kind: str, keys: list[str], status: str, reason: str | None,
    decided_by: str | None,
) -> int:
    """Одобрить или не одобрить предложенное в дроп. У отказа причина
    обязательна: «почему не взяли» спросят позже, и ответить будет нечем."""
    from datetime import UTC

    if status not in ("approved", "rejected"):
        raise BadDecision(f"незнакомое решение {status}")
    clean = (reason or "").strip() or None
    if status == "rejected" and not clean:
        raise BadDecision("у отказа нужна причина")
    keys = [(_normalise_text(k) if kind == "text" else k) for k in keys]
    return await repo.decide(db, kind, keys, drop_id, status, clean, decided_by, datetime.now(UTC))


@dataclass(frozen=True)
class Defect:
    """Брак: какая картинка, почему, кто и когда."""

    digest: str
    reason: str
    marked_by: str | None
    marked_at: datetime


async def defect_of(db: AsyncSession, digests: list[str]) -> dict[str, Defect]:
    """Брак по файлам — и по той же картинке в другом файле: пересохранённая
    или уменьшенная вдвое узнаётся вектором (план 071), и брак к ней тоже
    прикладывается. Ключ — проверяемый файл."""
    if not digests:
        return {}
    out: dict[str, Defect] = {}
    marked = await repo.all_defects(db)
    if not marked:
        return {}
    for d in digests:
        if d in marked:
            m = marked[d]
            out[d] = Defect(m.digest, m.reason, m.marked_by, m.marked_at)
            continue
        for same in await same_as(db, d, kind="image"):
            if same in marked:
                m = marked[same]
                out[d] = Defect(m.digest, m.reason, m.marked_by, m.marked_at)
                break
    return out


async def mark_defect(db: AsyncSession, digest: str, reason: str, by: str | None) -> None:
    why = (reason or "").strip()
    if not why:
        raise BadDecision("у брака нужна причина")
    await repo.mark_defect(db, digest, why, by)


async def unmark_defect(db: AsyncSession, digest: str) -> None:
    await repo.unmark_defect(db, digest)

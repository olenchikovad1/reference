"""Дропы, их ассортимент и справочники: товарная иерархия, модели, цветомодели, адресаты.

Слой: services. Правила предметной области. Единственный слой, который их содержит.

Справочники свои (решение 0013). Правил здесь два: ассортимент дропа
показывается матрицей «модели × цвета» — одна модель живёт в нескольких дропах
разными цветами, и в дереве она повторялась бы; на модели без кадров работу не
начать, и причина названа, а не спрятана.
"""

import pathlib
import re
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

import numpy as np
import yaml

from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.models.drops import ColourModel, Drop, GarmentModel, HierarchyNode
from reference_api.repositories import drops as repo
from reference_api.repositories import products as products_repo
from reference_api.services import colours

NO_FRAMES = "у изделия нет кадров для работы"


class DropNotFound(Exception):
    """Такого дропа нет."""


class CannotWork(Exception):
    """На цветомодели работу не начать: нет такой или у изделия нет кадров."""


@dataclass(frozen=True)
class Workability:
    can_work: bool
    reason: str | None


def workability(model: GarmentModel) -> Workability:
    """Можно ли рисовать на модели: нужно изделие приложения с кадрами."""
    if not model.product_code or products_repo.load_product(model.product_code) is None:
        return Workability(False, NO_FRAMES)
    return Workability(True, None)


async def drops(db: AsyncSession, active_only: bool = False) -> list[Drop]:
    return await repo.drops(db, active_only)


def _palette_by_code() -> dict[str, dict[str, Any]]:
    return {c["code"]: c for c in colours.palette()["colors"]}


async def matrix(db: AsyncSession, drop_id: int) -> dict[str, Any]:
    """Ассортимент дропа: строки — модели, столбцы — цвета, в ячейке —
    цветомодель и сколько на ней референсов. Ноль — «ещё не нарисовано»."""
    d = await repo.drop(db, drop_id)
    if d is None:
        raise DropNotFound(drop_id)
    counts = await repo.references_by_colour_model(db, [cm.id for cm in d.items])
    palette = _palette_by_code()
    order = list(palette)
    models: dict[int, GarmentModel] = {}
    cells: dict[int, dict[str, dict[str, int]]] = {}
    for cm in d.items:
        models[cm.model_id] = cm.model
        cells.setdefault(cm.model_id, {})[cm.colour_code] = {
            "colour_model_id": cm.id, "references": counts.get(cm.id, 0)}
    used = sorted({cm.colour_code for cm in d.items}, key=lambda c: order.index(c) if c in order else len(order))
    return {
        "drop": d,
        "colours": [{"code": c, "name": palette.get(c, {}).get("group", c), "rgb": palette.get(c, {}).get("rgb")}
                    for c in used],
        "rows": [{"model": models[mid], "cells": cells[mid]} for mid in sorted(models, key=lambda i: models[i].code)],
    }


async def tree(db: AsyncSession) -> list[HierarchyNode]:
    return await repo.roots(db)


async def colour_model_for_work(db: AsyncSession, colour_model_id: int) -> ColourModel:
    """Цветомодель, на которой можно рисовать; иначе — отказ с причиной."""
    cm = await repo.colour_model(db, colour_model_id)
    if cm is None:
        raise CannotWork(f"нет цветомодели {colour_model_id}")
    w = workability(cm.model)
    if not w.can_work:
        raise CannotWork(w.reason or NO_FRAMES)
    return cm


@dataclass(frozen=True)
class DropRef:
    id: int
    name: str
    retired: bool


@dataclass(frozen=True)
class ColourPlace:
    """Где цветомодель: цвет палитры, дропы, адресат и вид одежды (US-0497).
    Референс берёт всё это от своей цветомодели."""

    colour_code: str
    #: Сначала действующие, погашенные в конце: погашенный остаётся виден там,
    #: где стоит, но первым его не называют.
    drops: list[str]
    drop_refs: list[DropRef]
    #: boys, girls — от узла «пол» над моделью; all — пола в иерархии нет.
    audience: str
    #: Вид одежды — категория модели: «Худи», «Футболки».
    category: str


def audience_of(category_id: int, nodes: dict[int, HierarchyNode]) -> str:
    """Адресат модели — от ближайшего узла с адресатом вверх по иерархии."""
    node = nodes.get(category_id)
    while node is not None:
        if node.audience:
            return node.audience
        node = nodes.get(node.parent_id) if node.parent_id else None
    return "all"


async def colour_models_of(db: AsyncSession, ids: list[int]) -> dict[int, ColourPlace]:
    """Место цветомоделей разом — для списка референсов и связей библиотеки."""
    found = await repo.colour_models(db, sorted(set(ids)))
    nodes = await repo.nodes(db) if found else {}
    out: dict[int, ColourPlace] = {}
    for cm_id, cm in found.items():
        ordered = sorted(cm.drops, key=lambda d: (d.retired, d.release_from))
        category = nodes.get(cm.model.category_id)
        out[cm_id] = ColourPlace(
            cm.colour_code,
            [d.name for d in ordered],
            [DropRef(d.id, d.name, d.retired) for d in ordered],
            audience_of(cm.model.category_id, nodes),
            category.name if category else "",
        )
    return out


async def check_drop_for_linking(db: AsyncSession, drop_id: int) -> Drop:
    """Дроп, которому можно назначить принт или надпись. Погашенный в выборе
    не предлагается — назначать в него нельзя, хотя стоящее там видно."""
    d = await repo.drop(db, drop_id)
    if d is None:
        raise DropNotFound(drop_id)
    if d.retired:
        raise CannotWork(f"дроп «{d.name}» погашен — назначать в него нельзя")
    return d


# ---------- поиск дропа по смыслу (US-0498) ----------

_WORD = re.compile(r"[\wё\-]+", re.IGNORECASE)

#: Основы названий месяцев: «июнь», «июня», «в июне» — одно.
_MONTHS = ("январ", "феврал", "март", "апрел", "ма", "июн", "июл", "август", "сентябр", "октябр", "ноябр", "декабр")
_MONTH_NAMES = ("январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь",
                "ноябрь", "декабрь")
#: Времена года — основой: «лето», «летний», «летом» — одно; месяцы — как в быту.
_SEASONS = {"зим": ({12, 1, 2}, "зимой"), "весн": ({3, 4, 5}, "весной"), "лет": ({6, 7, 8}, "летом"),
            "осен": ({9, 10, 11}, "осенью")}


@lru_cache(maxsize=1)
def _abbreviations() -> dict[str, str]:
    raw = yaml.safe_load((pathlib.Path(__file__).with_name("abbreviations.yaml")).read_text(encoding="utf-8")) or {}
    return {str(k).upper(): str(v) for k, v in raw.items()}


def expand(query: str) -> str:
    """Запрос с раскрытыми сокращениями: «НГ» → «НГ новый год». Модель смысла
    сокращений не знает — для неё «НГ» две буквы."""
    q = query.strip()
    abbr = _abbreviations()
    extra = [abbr[q.upper()]] if q.upper() in abbr else []
    for w in q.upper().split():
        if w in abbr and abbr[w] not in extra:
            extra.append(abbr[w])
    return " ".join([q, *extra])


def drop_text(d: Drop) -> str:
    """Дроп словами для модели смысла: название, тема, как его ещё называют."""
    return ". ".join(x for x in (d.name, d.theme, ", ".join(d.aliases or [])) if x)


def months_of(d: Drop) -> list[int]:
    """Месяцы выхода дропа по порядку: 1 декабря – 28 декабря → [12]."""
    out: list[int] = []
    y, m = d.release_from.year, d.release_from.month
    while (y, m) <= (d.release_to.year, d.release_to.month):
        out.append(m)
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def _words(text: str) -> set[str]:
    # Числа не слова: «2027» совпало бы со всеми дропами года.
    return {w for w in _WORD.findall(text.lower()) if len(w) >= 3 and not w.isdigit()}


def _stem(w: str) -> str:
    """Грубая основа русского слова — без окончания: «зимний» → «зим»,
    «новогодний» → «новогод». Грубость нарочная: словаря форм нет (запрет на
    внешние зависимости здесь ни при чём — нет нужды), а лишнее совпадение
    основы стоит дешевле, чем пропущенный дроп."""
    return w[: max(3, len(w) - 3)]


def _hits(query_words: set[str], text: str) -> bool:
    return any(x.startswith(_stem(w)) or w.startswith(_stem(x)) for w in query_words for x in _words(text))


def words_meet(a: str, b: str) -> bool:
    """Есть ли у двух текстов общее слово по основе: «снежное» и «снег»."""
    return _hits(_words(a), b)


def _season_of(query_words: set[str]) -> tuple[set[int], str] | None:
    for w in query_words:
        for stem, (months, said) in _SEASONS.items():
            if w.startswith(stem):
                return months, said
        for i, stem in enumerate(_MONTHS):
            if (w.startswith(stem) and stem != "ма") or re.fullmatch(r"ма[йя]|мае", w):
                if stem == "ма" and not re.fullmatch(r"ма[йя]|мае", w):
                    continue
                return {i + 1}, f"в {_MONTH_NAMES[i]}"
    return None


@lru_cache(maxsize=1)
def _vocabulary_mean() -> np.ndarray:
    """Среднее словаря существительных — центр смещённого пространства модели
    (замер scripts/embeddings/measure_drop_meaning.py --centered)."""
    from reference_api.services import words

    _, vectors = words.vocabulary(2000, "{}")
    return vectors.mean(0)


@dataclass(frozen=True)
class DropMatch:
    drop: Drop
    #: 1 — по названию или «как ещё называют», 0.9 — по теме, 0.8 — по месяцам
    #: выхода, ниже — по смыслу (косинус модели).
    score: float
    #: Почему найдено — словами, для показа.
    why: str


async def match_drops(db: AsyncSession, query: str) -> list[DropMatch]:
    """Дропы по запросу — словами, контекстом и смыслом (US-0498).

    Слова — название, «как его ещё называют» и тема, по основам слов, после
    раскрытия сокращений. Контекст — то, чего модель не знает, а данные
    знают: «лето» совпадает с дропом, который выходит в июне. Смысл — косинус
    многоязычной модели к описанию дропа, порог — замером.
    """
    from reference_api.config import settings
    from reference_api.services import words

    expanded = expand(query)
    qw = _words(expanded)
    if not qw:
        return []
    all_drops = await repo.drops(db)
    found: dict[int, DropMatch] = {}

    def put(m: DropMatch) -> None:
        if m.drop.id not in found or found[m.drop.id].score < m.score:
            found[m.drop.id] = m

    season = _season_of(qw)
    for d in all_drops:
        if _hits(qw, " ".join([d.name, *(d.aliases or [])])):
            put(DropMatch(d, 1.0, f"дроп «{d.name}»"))
        elif d.theme and _hits(qw, d.theme):
            put(DropMatch(d, 0.9, f"дроп «{d.name}»: тема «{d.theme}»"))
        elif season and season[0] & set(months_of(d)):
            put(DropMatch(d, 0.8, f"дроп «{d.name}» выходит {season[1]}"))
    threshold = settings().drop_meaning_close
    if all_drops:
        # Пространство модели смещено: любые два текста близки (0.8–0.97), и
        # «жираф» набирал 0.81. Косинус меряется по остаткам после вычитания
        # среднего словаря — так «НГ» к «Новому году» 0.69, к «Зиме» 0.33.
        vectors = words.embed([expanded, *[drop_text(d) for d in all_drops]]) - _vocabulary_mean()
        vectors = vectors / np.linalg.norm(vectors, axis=1, keepdims=True)
        for d, cos in zip(all_drops, vectors[1:] @ vectors[0], strict=True):
            if cos >= threshold:
                put(DropMatch(d, float(cos) * 0.7, f"дроп «{d.name}» — по смыслу"))
    return sorted(found.values(), key=lambda m: -m.score)

"""Автотеги: двадцать самых сильных слов словаря языка по весам (US-0482).

Списка допустимых тегов нет: слова берутся из частотного словаря русского
языка (services/words.py), первые `tag_words` по частоте, и модель сама
выбирает, какие из них про картинку. Вектор картинки уже посчитан при
узнавании; вес слова — его доля среди всех этих слов (softmax по похожести с
масштабом CLIP, 100). На каждую картинку — одно умножение матрицы слов на
вектор.

Сцену («снег», «зима», «лес») схема не находит: слов про предмет сотни, и
каждое ближе к картинке, чем снег. Замер и две неудачные попытки — решение
0011, дополнение.

Сильные — те из двадцати, чей вес не меньше заданной доли от самого сильного,
и не больше десяти: у картинки с одним явным предметом сильный может быть
один. Где кончаются сильные, решает вес, а не число. Доля подобрана замером
(prints.yaml, measured_words).

Одна категория не ставится никогда — принадлежность людей к народу, вере или
политической силе (tags_excluded.yaml, там же причина).

Прежний закрытый словарь из тридцати слов с группами и следствиями отвергнут
владельцем 24.09: «не хочу заводить список допустимых тегов» (решение 0011,
дополнение).
"""

import hashlib
import json
import pathlib
from dataclasses import dataclass
from functools import lru_cache

import numpy as np
import yaml

from reference_api.config import settings
from reference_api.services import words

#: Сколько тегов у картинки и сколько из них может быть сильных.
TOP = 20
STRONG_MAX = 10
#: Масштаб похожести, с которым CLIP учили: при нём разница косинусов в 0.01
#: — это разница весов в e раз.
_SCALE = 100.0


@dataclass(frozen=True)
class Tag:
    code: str
    name: str
    score: float
    strong: bool


@lru_cache
def excluded() -> frozenset[str]:
    """Слова, которые тегом не ставятся никогда. Перечень лежит рядом с кодом,
    а не в данных стенда: это запрет, и он должен ехать туда же, куда код."""
    path = pathlib.Path(__file__).with_name("tags_excluded.yaml")
    groups = yaml.safe_load(path.read_text(encoding="utf-8"))
    return frozenset(w for ws in groups.values() for w in ws)


@lru_cache
def model_name() -> str:
    """Имя пишется рядом с каждым тегом. В него входят модель, словарь, шаблон
    фразы, число слов и перечень исключённого: сменилось любое — сменилось
    имя, и теги пересчитываются, а не смешиваются со старыми. Доля сильных в
    имя не входит: сильные считаются из весов при каждом чтении."""
    cfg = settings()
    key = json.dumps([cfg.tag_template, cfg.tag_words, sorted(excluded())], ensure_ascii=False)
    return f"{words.MODEL_NAME}/freq2011/{hashlib.sha256(key.encode()).hexdigest()[:8]}"


@lru_cache
def _vocabulary() -> tuple[list[str], np.ndarray]:
    """Слова словаря без исключённых и их векторы — раз на процесс."""
    cfg = settings()
    vocab, vecs = words.vocabulary(cfg.tag_words, cfg.tag_template)
    drop = excluded()
    keep = [i for i, w in enumerate(vocab) if w not in drop]
    return [vocab[i] for i in keep], vecs[keep]


def tag(vector: list[float]) -> list[Tag]:
    """Двадцать тегов картинки по убыванию веса, сильные помечены."""
    vocab, vecs = _vocabulary()
    img = np.asarray(vector, dtype=np.float32)
    s = vecs @ (img / np.linalg.norm(img))
    p = np.exp((s - s.max()) * _SCALE)
    p /= p.sum()
    order = np.argsort(-p)[:TOP]
    scores = [float(p[i]) for i in order]
    return [
        Tag(vocab[i], vocab[i], w, strong)
        for i, w, strong in zip(order, scores, strong_of(scores), strict=True)
    ]


def strong_of(scores: list[float]) -> list[bool]:
    """Какие из тегов сильные — одним правилом и при постановке, и для
    сохранённых: хранятся веса, а граница считается из них. Так смена доли не
    требует пересчёта тегов."""
    if not scores:
        return []
    top = max(scores)
    share = settings().tag_strong_share
    rank = {i: r for r, i in enumerate(sorted(range(len(scores)), key=lambda i: -scores[i]))}
    return [rank[i] < STRONG_MAX and scores[i] >= top * share for i in range(len(scores))]

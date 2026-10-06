"""Вид картинки — аниме, иллюстрация, плоская графика, надпись, фото — и в
какую модель она идёт на разметку (план 087, US-0625).

Вид решает один маршрутизатор, и все разметчики берут его ответ: загрузка,
переразметка и замер. Иначе каждая модель угадывала бы вид по-своему и одна
картинка попадала бы в разные модели в зависимости от пути.

Классификатор нулевой, без обучения: вектор картинки против фраз про вид,
через ту же многоязычную текстовую модель, что ставит теги, — она и так в
памяти. Замер на эталоне (tag_benchmark.yaml, measured_router): вид целиком
различается плохо — фото путается с иллюстрацией, — но маршрут решает одно:
аниме или нет. Аниме доходит до аниме-модели все 9 из 9; фото, иллюстрации,
плоская графика и надписи идут в одну общую модель (US-0627), и путаница
между ними маршрута не меняет.

Неуверенная картинка — зазор первого и второго вида меньше порога — идёт в
модели обоих: аниме-персонаж на фото получает и аниме-теги, и теги сцены.
Поправка рукой снимает неуверенность: человек сказал, что это.
"""

from dataclasses import dataclass
from functools import lru_cache

import numpy as np

from reference_api.config import settings
from reference_api.services import words

#: Порядок — порядок показа в выборе вида.
NAMES = {
    "anime": "аниме",
    "illustration": "иллюстрация",
    "flat": "плоская графика",
    "text": "надпись",
    "photo": "фото",
}
KINDS = tuple(NAMES)

#: Фразы вида, по-английски: на них мерился порог. Несколько на вид — у
#: манеры много имён, и среднее по ним устойчивее одной фразы.
_PROMPTS = {
    "anime": ["an anime illustration", "a manga drawing of a character", "anime style art"],
    "illustration": ["a detailed digital painting", "a shaded illustration", "a realistic drawing"],
    "flat": ["a flat vector clipart", "a simple cartoon icon", "a line art drawing"],
    "text": ["typography", "a word written in letters", "a logo with text", "graffiti lettering"],
    "photo": ["a photo", "a photograph", "a realistic 3d render"],
}

#: Какая модель размечает вид. Аниме-модели пока нет (US-0626) — до неё
#: «anime» размечается общей, но маршрут уже решён и хранится.
_TAGGER = {"anime": "anime", "illustration": "general", "flat": "general", "text": "general", "photo": "general"}

#: Имя маршрутизатора пишется рядом с видом: сменились фразы или модель —
#: вид пересчитывается, а не смешивается со старым.
ROUTER_NAME = f"{words.MODEL_NAME}/kinds-v1"


def gap_min() -> float:
    return settings().kind_gap_min


@dataclass(frozen=True)
class Verdict:
    kind: str
    second: str | None
    gap: float
    #: Поправка рукой. Есть — вид её, и неуверенности нет.
    manual: str | None = None

    @property
    def shown(self) -> str:
        return self.manual or self.kind

    @property
    def both(self) -> bool:
        return self.manual is None and self.second is not None and self.gap < gap_min()


@lru_cache
def _phrases() -> tuple[np.ndarray, ...]:
    return tuple(words.embed(_PROMPTS[k]) for k in KINDS)


def classify(vector: list[float]) -> Verdict:
    img = np.asarray(vector, dtype=np.float32)
    img = img / np.linalg.norm(img)
    scores = np.array([float((m @ img).mean()) for m in _phrases()])
    order = np.argsort(-scores)
    return Verdict(KINDS[order[0]], KINDS[order[1]], float(scores[order[0]] - scores[order[1]]))


def taggers(v: Verdict) -> list[str]:
    """Модели, которые размечают картинку: своя, а у неуверенной — ещё и модель
    второго вида. Порядок — сначала модель первого вида."""
    out = [_TAGGER[v.shown]]
    if v.both and v.second is not None and _TAGGER[v.second] not in out:
        out.append(_TAGGER[v.second])
    return out

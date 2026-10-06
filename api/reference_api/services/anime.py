"""Аниме-разметчик: WD-tagger v3 (Danbooru) — теги внешности, одежды, позы и
фона, персонажи и рейтинг (план 087, US-0626).

Английский тег человеку не показывается: перевод — anime_tags_ru.yaml рядом,
непереведённое не показывается вовсе. Запрет категорий (tags_excluded.yaml)
применяется к словам перевода: у аниме-модели свой словарь, но запрет общий.

Из трёх выходов модели два — не теги, а предупреждения:
- персонаж — «похоже на персонажа чужой франшизы, проверьте лицензию»:
  о правах узнают до согласования, а не после;
- рейтинг выше «general» и теги из перевода с «!» — «взрослое»: принты
  детские. Картинку это не прячет, решает человек.

Модель грузится при первой аниме-картинке, а не при старте: большинство
загрузок — не аниме, а память под модели ограничена (models.json).
"""

import csv
import io
import pathlib
import threading
from dataclasses import dataclass, field
from functools import lru_cache

import numpy as np
import yaml
from PIL import Image

from reference_api.config import settings
from reference_api.services import models
from reference_api.services import tags as tagging

#: Пороги — умолчания автора модели (SmilingWolf): общие теги 0.35,
#: персонажи 0.85. Персонаж ниже порога — не предупреждение, а шум.
GENERAL_MIN = 0.35
CHARACTER_MIN = 0.85
#: Рейтинги Danbooru по возрастанию откровенности.
RATINGS = ("general", "sensitive", "questionable", "explicit")
ADULT_RATINGS = {"questionable", "explicit"}

_lock = threading.Lock()


@dataclass(frozen=True)
class Tag:
    code: str
    #: Показ по-русски.
    name: str
    #: Слова в словарной форме — для поиска и сверки с эталоном.
    words: tuple[str, ...]
    score: float


@dataclass
class Result:
    tags: list[Tag]
    #: Узнанный персонаж: имя в словаре модели и уверенность.
    characters: list[tuple[str, float]]
    rating: str
    #: Почему «взрослое»: рейтинг и/или теги с «!». Пусто — не взрослое.
    adult: list[str] = field(default_factory=list)
    #: Теги выше порога без перевода — не показаны; замер их считает.
    untranslated: list[str] = field(default_factory=list)


def model_dir(model_id: str | None = None) -> pathlib.Path:
    return pathlib.Path(settings().files_volume_path) / "models" / (model_id or settings().anime_model)


@lru_cache
def _translation() -> dict[str, tuple[str, tuple[str, ...]] | str]:
    raw = yaml.safe_load(pathlib.Path(__file__).with_name("anime_tags_ru.yaml").read_text(encoding="utf-8"))
    banned = tagging.excluded()
    out: dict[str, tuple[str, tuple[str, ...]] | str] = {}
    for code, value in raw.items():
        if value in ("~", "!"):
            out[str(code)] = value
            continue
        shown, sep, words = str(value).partition("|")
        ws = tuple(w.strip() for w in words.split(",") if w.strip()) if sep else (shown.strip(),)
        if any(w in banned for w in ws):
            out[str(code)] = "~"
            continue
        out[str(code)] = (shown.strip(), ws)
    return out


@lru_cache(maxsize=4)
def _loaded(model_id: str):
    base = model_dir(model_id)
    session = models.session(base / "model.onnx")
    with open(models.require(base / "selected_tags.csv"), encoding="utf-8") as f:
        labels = [(r["name"], int(r["category"])) for r in csv.DictReader(f)]
    return session, labels


def model_name(model_id: str | None = None) -> str:
    """Имя рядом с тегом: модель и перевод. Сменился перевод — теги
    пересчитываются, а не смешиваются со старыми."""
    import hashlib

    key = pathlib.Path(__file__).with_name("anime_tags_ru.yaml").read_bytes()
    return f"{model_id or settings().anime_model}/ru-{hashlib.sha256(key).hexdigest()[:8]}"


def preprocess(content: bytes, side: int) -> np.ndarray:
    """Как учили модель: квадрат с белыми полями, BGR, 0…255, без нормировки.
    Прозрачность — на белое: у принтов прозрачный фон."""
    with Image.open(io.BytesIO(content)) as opened:
        img: Image.Image = opened
        img = img.convert("RGBA")
        white = Image.new("RGBA", img.size, (255, 255, 255, 255))
        img = Image.alpha_composite(white, img).convert("RGB")
        n = max(img.size)
        square = Image.new("RGB", (n, n), (255, 255, 255))
        square.paste(img, ((n - img.width) // 2, (n - img.height) // 2))
        square = square.resize((side, side), Image.Resampling.BICUBIC)
        arr = np.asarray(square, dtype=np.float32)[:, :, ::-1]
    return np.ascontiguousarray(arr[None, ...])


def tag(content: bytes, model_id: str | None = None) -> Result:
    session, labels = _loaded(model_id or settings().anime_model)
    inp = session.get_inputs()[0]
    with _lock:
        probs = session.run(None, {inp.name: preprocess(content, inp.shape[1])})[0][0]
    tr = _translation()
    ratings = {n: float(p) for (n, c), p in zip(labels, probs, strict=True) if c == 9}
    rating = max(ratings, key=ratings.__getitem__)
    tags: list[Tag] = []
    chars: list[tuple[str, float]] = []
    adult = [f"рейтинг {rating}"] if rating in ADULT_RATINGS else []
    untranslated: list[str] = []
    for (name, cat), p in sorted(zip(labels, probs, strict=True), key=lambda x: -x[1]):
        p = float(p)
        if cat == 4 and p >= CHARACTER_MIN:
            chars.append((name, p))
        elif cat == 0 and p >= GENERAL_MIN:
            t = tr.get(name)
            if t is None:
                untranslated.append(name)
            elif t == "!":
                adult.append(name)
            elif isinstance(t, tuple):  # «~» — перевод намеренно пропущен
                tags.append(Tag(name, t[0], t[1], p))
    return Result(tags, chars, rating, adult, untranslated)


def character_warning(name: str) -> str:
    """«saber_(fate)» → «Saber (Fate)»: имя и франшиза, как их ищут."""
    base, _, franchise = name.partition("_(")
    who = base.replace("_", " ").title()
    return (f"похоже на персонажа «{who}»" + (f" из «{franchise.rstrip(')').replace('_', ' ').title()}»" if franchise else "")
            + " — проверьте лицензию")

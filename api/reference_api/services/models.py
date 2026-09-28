"""Модели стенда: на месте ли, те ли, и на чём их запускать (US-0624).

Что должно лежать в томе — опись `models.json` в описаниях стенда; качает её
`scripts/stand/fetch_models.py`. Здесь — то, что видит сервис: нет файла или
он подменён — отказ называет файл и команду. Без этого на чистой машине
разметка падала FileNotFoundError из недр onnxruntime, а подменённая модель
того же размера размечала бы молча иначе.

Видеокарта берётся, если onnxruntime её видит (образ с CUDA и `gpus` в
compose), иначе — процессор. Выбор в одном месте: модели не решают сами.
"""

import hashlib
import json
import logging
import pathlib
from dataclasses import dataclass

import onnxruntime as ort

from reference_api.config import settings

log = logging.getLogger("reference.models")

FETCH = "py scripts/stand/fetch_models.py"

#: Что стартовая сверка нашла не тем: путь относительно тома → находка.
#: Считать sha256 на каждый запрос дорого, а размечать подменённой моделью
#: молча нельзя — поэтому вердикт старта помнится до перезапуска.
_flagged: dict[str, "Problem"] = {}


@dataclass(frozen=True)
class Problem:
    path: str
    #: «нет» или «не тот»
    reason: str

    def __str__(self) -> str:
        return f"модели {self.path} {'нет' if self.reason == 'нет' else 'не та, что в описи'} — {FETCH}"


class ModelMissing(RuntimeError):
    """Модели нет в томе. Ожидаемый отказ стенда, а не поломка кода: ответ
    503 с тем же текстом, что в журнале."""


def inventory() -> list[dict]:
    """Файлы описи плоским списком, пути — относительно тома файлов."""
    data = json.loads((pathlib.Path(settings().fixtures_path) / "models.json").read_text(encoding="utf-8"))
    return [f for m in data["models"] for f in m["files"]]


def _sha256(path: pathlib.Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


def problems(full: bool) -> list[Problem]:
    """Чего не хватает. `full` — ещё и сверка sha256: секунда на весь том,
    поэтому при старте, а не на каждый запрос."""
    root = pathlib.Path(settings().files_volume_path)
    out = []
    for f in inventory():
        path = root / f["path"]
        if not path.is_file():
            out.append(Problem(f["path"], "нет"))
        elif path.stat().st_size != f["size"] or (full and _sha256(path) != f["sha256"]):
            out.append(Problem(f["path"], "не тот"))
    return out


def require(path: str | pathlib.Path) -> str:
    """Путь к файлу модели — или отказ с именем файла и командой."""
    p = pathlib.Path(path)
    root = pathlib.Path(settings().files_volume_path)
    rel = str(p.relative_to(root) if p.is_relative_to(root) else p)
    if not p.is_file():
        raise ModelMissing(str(Problem(rel, "нет")))
    if rel in _flagged:
        raise ModelMissing(str(_flagged[rel]))
    return str(p)


def providers() -> list[str]:
    """Видеокарта первой, если есть; процессор остаётся запасным — на него
    onnxruntime уходит сам, если узел модели на видеокарте не исполняется."""
    available = ort.get_available_providers()
    return (["CUDAExecutionProvider"] if "CUDAExecutionProvider" in available else []) + ["CPUExecutionProvider"]


def session(path: str | pathlib.Path) -> ort.InferenceSession:
    return ort.InferenceSession(require(path), providers=providers())


def report_at_start() -> None:
    """В журнал при старте: какие модели не на месте и где разметка откажет."""
    found = problems(full=True)
    _flagged.clear()
    _flagged.update({p.path: p for p in found})
    for p in found:
        log.error("%s", p)
    if not found:
        log.info("модели на месте: %d файлов, запуск на %s", len(inventory()), providers()[0])

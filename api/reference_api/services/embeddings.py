"""Векторы изображений: своя модель, локально.

Принты — невыпущенные дропы, и отправлять их внешнему провайдеру до релиза
нельзя. Плюс архив живёт годами, а чужая модель меняется без спроса: пересчитать
старые векторы внешним API невозможно, воспроизвести нечем (решение 0008).

Вектор хранится ВМЕСТЕ с именем модели. Векторы разных моделей несравнимы, и
смешанные они дают поиск, который не падает, а молча меряет не ту похожесть —
выдача выглядит правдоподобной, а ошибку заметить нечем.
"""

import io
import threading
from dataclasses import dataclass

import numpy as np
import onnxruntime as ort
from PIL import Image

from reference_api.config import settings

#: Имя модели пишется рядом с каждым вектором. Сменится модель — сменится имя,
#: и старые векторы не смешаются с новыми.
MODEL_NAME = "clip-vit-base-patch32/vision/quantized"
DIM = 512

# Предобработка ровно та, на которой модель училась. Числа не наши и подгонке
# не подлежат: изменить их значит считать не то, что модель понимает.
SIDE = 224
MEAN = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
STD = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)

_session: ort.InferenceSession | None = None
_lock = threading.Lock()


@dataclass(frozen=True)
class Embedding:
    model: str
    vector: list[float]


def session() -> ort.InferenceSession:
    """Одна сессия на процесс: загрузка модели — не то, что делают в цикле."""
    global _session
    with _lock:
        if _session is None:
            _session = ort.InferenceSession(
                settings().embedding_model_path, providers=["CPUExecutionProvider"]
            )
        return _session


def preprocess(content: bytes) -> np.ndarray:
    """Картинка к виду, который понимает модель.

    Прозрачность сводится на БЕЛОЕ, а не на чёрное: у принтов прозрачный фон,
    и сведение на чёрное превратило бы светлый рисунок в тёмное пятно, то есть
    поменяло бы вектор до неузнаваемости.
    """
    with Image.open(io.BytesIO(content)) as img:
        if img.mode in ("RGBA", "LA", "P"):
            img = img.convert("RGBA")
            white = Image.new("RGBA", img.size, (255, 255, 255, 255))
            img = Image.alpha_composite(white, img)
        img = img.convert("RGB").resize((SIDE, SIDE), Image.Resampling.BICUBIC)
        arr = np.asarray(img, dtype=np.float32) / 255.0
    arr = (arr - MEAN) / STD
    return arr.transpose(2, 0, 1)[None, ...]


def embed(content: bytes) -> Embedding:
    """Вектор изображения, нормированный к единичной длине.

    Нормирование делает косинусное расстояние обычным скалярным произведением,
    и сравнение перестаёт зависеть от яркости картинки.
    """
    out = session().run(None, {"pixel_values": preprocess(content)})
    vec = np.asarray(out[0], dtype=np.float32).reshape(-1)[:DIM]
    norm = float(np.linalg.norm(vec)) or 1.0
    return Embedding(MODEL_NAME, (vec / norm).tolist())


def similarity(a: list[float], b: list[float]) -> float:
    """Косинусная близость двух нормированных векторов."""
    return float(np.dot(np.asarray(a, dtype=np.float32), np.asarray(b, dtype=np.float32)))

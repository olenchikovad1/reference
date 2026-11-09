"""Векторы изображений: своя модель, локально.

Принты — невыпущенные дропы, и отправлять их внешнему провайдеру до релиза
нельзя. Плюс архив живёт годами, а чужая модель меняется без спроса: пересчитать
старые векторы внешним API невозможно, воспроизвести нечем (решение 0008).

Вектор хранится ВМЕСТЕ с именем модели. Векторы разных моделей несравнимы, и
смешанные они дают поиск, который не падает, а молча меряет не ту похожесть —
выдача выглядит правдоподобной, а ошибку заметить нечем.
"""

import io
import json
import math
import socket
import threading
from dataclasses import dataclass
from http.client import HTTPConnection, HTTPException

import numpy as np
import onnxruntime as ort
from PIL import Image

from reference_api.config import settings
from reference_api.services import models

#: Имя модели пишется рядом с каждым вектором. Сменится модель — сменится имя,
#: и старые векторы не смешаются с новыми.
MODEL_NAME = "clip-vit-base-patch32/vision/quantized"
DIM = 512

# Предобработка ровно та, на которой модель училась. Числа не наши и подгонке
# не подлежат: изменить их значит считать не то, что модель понимает.
SIDE = 224
INPUT_SHAPE = (1, 3, SIDE, SIDE)
INPUT_DTYPE = np.dtype("<f4")
INPUT_BYTES = math.prod(INPUT_SHAPE) * INPUT_DTYPE.itemsize
ENCODE_PATH = "/v1/encode"
_WORKER_TIMEOUT_SECONDS = 15
_RESPONSE_LIMIT = 32 * 1024
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
            _session = models.session(settings().embedding_model_path)
        return _session


def preprocess(content: bytes) -> np.ndarray:
    """Картинка к виду, который понимает модель.

    Прозрачность сводится на БЕЛОЕ, а не на чёрное: у принтов прозрачный фон,
    и сведение на чёрное превратило бы светлый рисунок в тёмное пятно, то есть
    поменяло бы вектор до неузнаваемости.
    """
    with Image.open(io.BytesIO(content)) as opened:
        img: Image.Image = opened
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
    pixels = preprocess(content)
    if socket_path := settings().image_embedding_socket:
        return _worker_embedding(socket_path, pixels)
    return encode(session(), pixels)


def encode(encoder: ort.InferenceSession, pixels: np.ndarray) -> Embedding:
    """Общая нормировка локальной модели и отдельного процесса CLIP."""
    out = encoder.run(None, {"pixel_values": pixels})
    vec = np.asarray(out[0], dtype=np.float32).reshape(-1)[:DIM]
    norm = float(np.linalg.norm(vec)) or 1.0
    return Embedding(MODEL_NAME, (vec / norm).tolist())


class _EncoderConnection(HTTPConnection):
    """Канал доступен только контейнерам с общим томом сокета."""

    def __init__(self, path: str) -> None:
        super().__init__("localhost", timeout=_WORKER_TIMEOUT_SECONDS)
        self.path = path

    def connect(self) -> None:
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(_WORKER_TIMEOUT_SECONDS)
        self.sock.connect(self.path)


def _worker_embedding(path: str, pixels: np.ndarray) -> Embedding:
    connection = _EncoderConnection(path)
    try:
        connection.request("POST", ENCODE_PATH, body=pixels.astype(INPUT_DTYPE, copy=False).tobytes(),
                           headers={"Content-Type": "application/octet-stream"})
        response = connection.getresponse()
        if response.status != 200:
            raise ValueError(f"encoder returned {response.status}")
        body = response.read(_RESPONSE_LIMIT + 1)
        if len(body) > _RESPONSE_LIMIT:
            raise ValueError("encoder response exceeded size limit")
        data = json.loads(body)
        vector = data["vector"]
        if data["model"] != MODEL_NAME or not isinstance(vector, list) or len(vector) != DIM or any(
            not isinstance(value, (int, float)) or not math.isfinite(value) for value in vector
        ):
            raise ValueError("encoder model or vector does not match the contract")
        return Embedding(MODEL_NAME, vector)
    except (OSError, HTTPException, ValueError, KeyError, TypeError, OverflowError) as failure:
        # Возврат к локальной модели здесь снова выделил бы её память внутри API.
        raise models.ModelMissing("сервис эмбеддингов изображений недоступен") from failure
    finally:
        connection.close()


def similarity(a: list[float], b: list[float]) -> float:
    """Косинусная близость двух нормированных векторов."""
    return float(np.dot(np.asarray(a, dtype=np.float32), np.asarray(b, dtype=np.float32)))

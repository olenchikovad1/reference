"""Расшифровка голоса своей моделью (US-0512, решение 0017).

Единственное место, где живёт faster-whisper: переход на другую модель или
на модели Яндекса — правка этого модуля. Модель грузится на время
расшифровки и выгружается после: в покое памяти не занимает, и бюджет
моделей (models.json) держится одной расшифровкой за раз.
"""

import ctypes
import gc
import io
import pathlib
import threading

from reference_api.config import settings
from reference_api.services import models

FOLDER = "faster-whisper-small"
#: Имя модели у расшифровки: по нему видно, чем расшифровано, когда модель сменят.
MODEL_NAME = f"{FOLDER}/int8"
FILES = ("model.bin", "config.json", "tokenizer.json", "vocabulary.txt")
#: Подсказка модели: слова дела пишутся так, как их пишут в работе. Whisper
#: берёт из неё написание, а не смысл — выдумать их в тексте она не может.
PROMPT = "Замечание к принту на худи: Об. 268, пантон, кокетка, капюшон, надпись, принт, левее, выше, см."

_lock = threading.Lock()


class Unheard(ValueError):
    """Аудио не разобрать — пустое, не звук или не тот формат."""


def transcribe(audio: bytes) -> tuple[str, float]:
    """Текст и длительность в секундах. Одна расшифровка за раз: две
    одновременно удвоили бы пик памяти."""
    from faster_whisper import WhisperModel

    base = pathlib.Path(settings().files_volume_path) / "models" / FOLDER
    for name in FILES:
        models.require(base / name)
    path = base
    with _lock:
        model = WhisperModel(str(path), device="cpu", compute_type="int8", cpu_threads=4)
        try:
            try:
                segments, info = model.transcribe(io.BytesIO(audio), language="ru", beam_size=5,
                                                  initial_prompt=PROMPT, vad_filter=False)
                text = " ".join(s.text.strip() for s in segments).strip()
            except Exception as e:  # av и ctranslate2 бросают свои, без общего предка
                raise Unheard(f"аудио не разобрать: {e}") from e
            return text, float(info.duration)
        finally:
            del model
            gc.collect()
            _give_back()


def _give_back() -> None:
    """Вернуть системе память выгруженной модели. Без этого glibc держит
    освобождённые сотни мегабайт у процесса, и «в покое памяти не занимает»
    было бы неправдой (замер measure_model_memory)."""
    try:
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except OSError:  # не glibc — нечего и некому отдавать
        pass

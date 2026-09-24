"""Русские слова в пространстве картинок (US-0482).

Многоязычный кодировщик `clip-ViT-B-32-multilingual-v1` дистиллирован в
пространство той же CLIP ViT-B/32, что считает векторы картинок: вектор слова
«снег» сравнивается с уже лежащим вектором картинки напрямую, без перевода и
без списка допустимых тегов.

В onnx лежит только трансформер. Остальное — как в описании модели: средний
пулинг по токенам с маской и слой 768→512 без смещения, веса которого лежат
отдельным файлом.

Слова берутся из «Нового частотного словаря русской лексики» — существительные,
по частоте. Это словарь языка, а не список допустимого: его никто не курирует.
Векторы всех слов считаются один раз и лежат в томе производных; сменились модель
или словарь — считаются заново.
"""

import csv
import hashlib
import io
import json
import pathlib
import struct
import threading
import zipfile
from functools import lru_cache

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

from reference_api.config import settings

MODEL_NAME = "clip-vit-b32-multilingual/quint8"
_lock = threading.Lock()


def _root() -> pathlib.Path:
    return pathlib.Path(settings().files_volume_path)


@lru_cache
def _encoder() -> tuple[Tokenizer, ort.InferenceSession, np.ndarray]:
    base = _root() / "models/clip-vit-b32-multilingual"
    tok = Tokenizer.from_file(str(base / "tokenizer.json"))
    tok.enable_padding(pad_id=0, pad_token="[PAD]")
    tok.enable_truncation(max_length=32)
    session = ort.InferenceSession(str(base / "model_quint8_avx2.onnx"), providers=["CPUExecutionProvider"])
    return tok, session, _dense(base / "dense.safetensors")


def _dense(path: pathlib.Path) -> np.ndarray:
    """Веса слоя 768→512 из safetensors: восемь байт длины заголовка, заголовок
    JSON, дальше сырые float32. Своей библиотеки ради одного массива не нужно."""
    raw = path.read_bytes()
    n = struct.unpack("<Q", raw[:8])[0]
    meta = json.loads(raw[8 : 8 + n])["linear.weight"]
    start, end = meta["data_offsets"]
    return np.frombuffer(raw[8 + n + start : 8 + n + end], dtype=np.float32).reshape(meta["shape"])


def embed(texts: list[str]) -> np.ndarray:
    """Нормированные векторы фраз, по строке на фразу."""
    tok, session, dense = _encoder()
    out = []
    with _lock:
        for i in range(0, len(texts), 64):
            batch = tok.encode_batch(texts[i : i + 64])
            ids = np.array([e.ids for e in batch], dtype=np.int64)
            mask = np.array([e.attention_mask for e in batch], dtype=np.int64)
            hidden = session.run(None, {"input_ids": ids, "attention_mask": mask})[0]
            m = mask[..., None].astype(np.float32)
            pooled = (hidden * m).sum(axis=1) / np.maximum(m.sum(axis=1), 1e-9)
            v = pooled @ dense.T
            out.append(v / np.linalg.norm(v, axis=1, keepdims=True))
    return np.concatenate(out) if out else np.zeros((0, 512), dtype=np.float32)


def nouns(limit: int | None = None) -> list[str]:
    """Существительные словаря по убыванию частоты. Буква «ё» в словаре
    записана как «е» — так и оставляется: поиск по «вертолёт» найдёт своё
    через вектор, а не через буквы."""
    path = _root() / "dictionaries/freq2011.zip"
    with zipfile.ZipFile(path) as z:
        text = z.read("freqrnc2011.csv").decode("utf-8")
    rows = list(csv.reader(io.StringIO(text), delimiter="\t"))[1:]
    seen: dict[str, float] = {}
    for lemma, pos, ipm, *_ in rows:
        if pos == "s" and lemma.isalpha():
            seen[lemma] = max(seen.get(lemma, 0.0), float(ipm))
    ordered = sorted(seen, key=lambda w: -seen[w])
    return ordered[:limit] if limit else ordered


@lru_cache
def _all(template: str) -> tuple[list[str], np.ndarray]:
    """Все существительные словаря и их векторы. Считаются один раз на шаблон
    и лежат в томе производных: ключ — модель, словарь и шаблон, поменялось
    любое — пересчёт. Меньшее число слов — срез отсюда: слова упорядочены по
    частоте, и первые пять тысяч — всегда одни и те же."""
    words = nouns()
    key = hashlib.sha256(json.dumps([MODEL_NAME, len(words), template, words[:50]]).encode()).hexdigest()[:16]
    cache = pathlib.Path(settings().cache_path) / f"words-{key}.npy"
    if cache.exists():
        return words, np.load(cache)
    vectors = embed([template.format(w) for w in words])
    cache.parent.mkdir(parents=True, exist_ok=True)
    tmp = cache.with_name(cache.stem + ".part.npy")
    np.save(tmp, vectors)
    tmp.replace(cache)
    return words, vectors


def vocabulary(limit: int, template: str) -> tuple[list[str], np.ndarray]:
    """Первые `limit` слов словаря по частоте и их векторы."""
    words, vectors = _all(template)
    return words[:limit], vectors[:limit]

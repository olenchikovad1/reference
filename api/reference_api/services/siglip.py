"""Общий разметчик на SigLIP 2 (план 087, US-0627, проба по слову владельца
28.09: «сделай как тест, если лучше — оставим до востребования»).

Ставит только общие теги — фото, иллюстрации, плоской графике, надписям.
Вектор картинки для узнавания и поиска остаётся от CLIP: так смена
разметчика не требует пересчёта векторов и порогов узнавания. Правило тегов
то же, что у CLIP (services/tags.py): softmax по словам частотного словаря
с масштабом 100, сильные — той же долей. Сравнивается модель, а не правило.

Замер на эталоне (tag_benchmark.yaml, measured_general): F1 по сильным на
42 картинках без аниме — 0.26 против 0.18 у CLIP. Текстовая половина сжата
до int8 ради памяти (0.29 → 0.26), картинка — нет: в int8 она падала до
уровня CLIP.

Векторы слов словаря считаются один раз и лежат в томе производных:
словарь через текстовую половину — минуты, не секунды.
"""

import hashlib
import io
import json
import pathlib
import threading
from functools import lru_cache

import numpy as np
from PIL import Image
from tokenizers import Tokenizer

from reference_api.config import settings
from reference_api.services import models, words

FOLDER = "siglip2-base-patch16-224"
VISION = "vision_model.onnx"
TEXT = "text_model_int8.onnx"
MODEL_NAME = f"{FOLDER}/v32-t8"
_lock = threading.Lock()


def _base() -> pathlib.Path:
    return pathlib.Path(settings().files_volume_path) / "models" / FOLDER


@lru_cache
def _vision():
    base = _base()
    pre = json.loads(pathlib.Path(models.require(base / "preprocessor_config.json")).read_text(encoding="utf-8"))
    return models.session(base / VISION), pre


@lru_cache
def _text():
    base = _base()
    tok = Tokenizer.from_file(models.require(base / "tokenizer.json"))
    # Так модель учили: строчными, дополнено до 64 токенов (карточка google/siglip2).
    tok.enable_padding(length=64, pad_id=0)
    tok.enable_truncation(max_length=64)
    session = models.session(base / TEXT)
    return tok, session, {i.name for i in session.get_inputs()}


def _pooled(session, feeds: dict) -> np.ndarray:
    outs = session.run(None, feeds)
    names = [o.name for o in session.get_outputs()]
    for want in ("pooler_output", "image_embeds", "text_embeds"):
        if want in names:
            return outs[names.index(want)]
    return next(o for o in outs if o.ndim == 2)


def embed_image(content: bytes) -> np.ndarray:
    session, pre = _vision()
    side = int(pre.get("size", {}).get("height", 224))
    mean = np.array(pre.get("image_mean", [0.5] * 3), dtype=np.float32)
    std = np.array(pre.get("image_std", [0.5] * 3), dtype=np.float32)
    with Image.open(io.BytesIO(content)) as opened:
        img: Image.Image = opened
        img = img.convert("RGBA")
        white = Image.new("RGBA", img.size, (255, 255, 255, 255))
        img = Image.alpha_composite(white, img).convert("RGB").resize((side, side), Image.Resampling.BILINEAR)
        arr = (np.asarray(img, dtype=np.float32) / 255.0 - mean) / std
    with _lock:
        v = _pooled(session, {session.get_inputs()[0].name: arr.transpose(2, 0, 1)[None, ...]})[0]
    return v / np.linalg.norm(v)


def embed_texts(texts: list[str]) -> np.ndarray:
    tok, session, inputs = _text()
    out = []
    with _lock:
        for i in range(0, len(texts), 64):
            enc = tok.encode_batch([t.lower() for t in texts[i : i + 64]])
            feeds = {"input_ids": np.array([e.ids for e in enc], dtype=np.int64)}
            if "attention_mask" in inputs:
                feeds["attention_mask"] = np.array([e.attention_mask for e in enc], dtype=np.int64)
            v = _pooled(session, feeds)
            out.append(v / np.linalg.norm(v, axis=1, keepdims=True))
    return np.concatenate(out)


@lru_cache
def vocabulary(limit: int, template: str) -> tuple[list[str], np.ndarray]:
    """Слова словаря (те же, что у CLIP) и их векторы SigLIP — из тома
    производных; нет там — считаются и кладутся."""
    vocab, _ = words.vocabulary(limit, template)
    key = hashlib.sha256(json.dumps([MODEL_NAME, template, vocab]).encode()).hexdigest()[:16]
    cache = pathlib.Path(settings().cache_path) / f"siglip-words-{key}.npy"
    if cache.exists():
        return vocab, np.load(cache)
    vectors = embed_texts([template.format(w) for w in vocab])
    cache.parent.mkdir(parents=True, exist_ok=True)
    tmp = cache.with_name(cache.stem + ".part.npy")
    np.save(tmp, vectors)
    tmp.replace(cache)
    return vocab, vectors

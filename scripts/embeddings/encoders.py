"""Кандидаты общей модели для замеров US-0627: картинка и текст в одном
пространстве. Нынешняя CLIP — через сервис (мерится то, что стоит в коде),
SigLIP 2 — прямо из onnx-файлов описи, до того как попала в сервис.

Предобработка SigLIP 2 — из preprocessor_config.json модели: квадрат 224,
билинейно, (x/255 − 0.5)/0.5. Текст — строчными, дополнен до 64 токенов:
так модель учили, без дополнения векторы другие (карточка google/siglip2).
"""

import io
import json
import pathlib

import numpy as np
import onnxruntime as ort
from PIL import Image
from tokenizers import Tokenizer

from reference_api.services import embeddings, words

MODELS = pathlib.Path("/srv/reference/files/models")


class Clip:
    name = "clip-b32 (нынешняя)"

    def image(self, content: bytes) -> np.ndarray:
        return np.asarray(embeddings.embed(content).vector, dtype=np.float32)

    def text(self, texts: list[str]) -> np.ndarray:
        return words.embed(texts)


def _norm(v: np.ndarray) -> np.ndarray:
    return v / np.linalg.norm(v, axis=-1, keepdims=True)


def _pooled(session: ort.InferenceSession, feeds: dict) -> np.ndarray:
    outs = session.run(None, feeds)
    names = [o.name for o in session.get_outputs()]
    for want in ("pooler_output", "image_embeds", "text_embeds"):
        if want in names:
            return outs[names.index(want)]
    return next(o for o in outs if o.ndim == 2)


class Siglip:
    def __init__(self, folder: str, vision: str, text: str) -> None:
        base = MODELS / folder
        self.name = f"{folder} ({vision.removesuffix('.onnx')}, {text.removesuffix('.onnx')})"
        self.text_file = f"{folder}/{text}"
        opts = ["CPUExecutionProvider"]
        self.vision = ort.InferenceSession(str(base / vision), providers=opts)
        self.textm = ort.InferenceSession(str(base / text), providers=opts)
        pre = json.loads((base / "preprocessor_config.json").read_text(encoding="utf-8"))
        self.side = int(pre.get("size", {}).get("height", 224))
        self.mean = np.array(pre.get("image_mean", [0.5] * 3), dtype=np.float32)
        self.std = np.array(pre.get("image_std", [0.5] * 3), dtype=np.float32)
        self.tok = Tokenizer.from_file(str(base / "tokenizer.json"))
        self.tok.enable_padding(length=64, pad_id=0)
        self.tok.enable_truncation(max_length=64)
        self.text_inputs = {i.name for i in self.textm.get_inputs()}

    def image(self, content: bytes) -> np.ndarray:
        with Image.open(io.BytesIO(content)) as img:
            img = img.convert("RGBA")
            white = Image.new("RGBA", img.size, (255, 255, 255, 255))
            img = Image.alpha_composite(white, img).convert("RGB").resize((self.side, self.side), Image.Resampling.BILINEAR)
            arr = (np.asarray(img, dtype=np.float32) / 255.0 - self.mean) / self.std
        v = _pooled(self.vision, {self.vision.get_inputs()[0].name: arr.transpose(2, 0, 1)[None, ...]})[0]
        return _norm(v)

    def text(self, texts: list[str]) -> np.ndarray:
        # Словарь в 10 000 слов через текстовую половину — десять минут и
        # больше; замер повторяется, поэтому векторы — в томе производных.
        import hashlib
        key = hashlib.sha256(json.dumps([self.text_file, texts]).encode()).hexdigest()[:16]
        cache = pathlib.Path("/srv/reference/cache") / f"cand-{key}.npy"
        if len(texts) > 100 and cache.exists():
            return np.load(cache)
        v = self._text(texts)
        if len(texts) > 100:
            np.save(cache, v)
        return v

    def _text(self, texts: list[str]) -> np.ndarray:
        out = []
        for i in range(0, len(texts), 64):
            enc = self.tok.encode_batch([t.lower() for t in texts[i : i + 64]])
            feeds = {"input_ids": np.array([e.ids for e in enc], dtype=np.int64)}
            if "attention_mask" in self.text_inputs:
                feeds["attention_mask"] = np.array([e.attention_mask for e in enc], dtype=np.int64)
            out.append(_norm(_pooled(self.textm, feeds)))
        return np.concatenate(out)


CANDIDATES = {
    "clip": lambda: Clip(),
    "siglip2-base": lambda: Siglip("siglip2-base-patch16-224", "vision_model.onnx", "text_model.onnx"),
    "siglip2-base-t8": lambda: Siglip("siglip2-base-patch16-224", "vision_model.onnx", "text_model_int8.onnx"),
    "siglip2-base-v8t8": lambda: Siglip("siglip2-base-patch16-224", "vision_model_int8.onnx", "text_model_int8.onnx"),
    "siglip2-so400m-8": lambda: Siglip("siglip2-so400m-patch14-224", "vision_model_int8.onnx", "text_model_int8.onnx"),
}

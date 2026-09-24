"""Автотеги: что модель видит на картинке, словами словаря.

Теги соревнуются ВНУТРИ СВОЕЙ ГРУППЫ, а не со всем словарём: у тегов разный
«фон», и одним порогом на всех снег всегда проигрывал случайному «кораблю»
(замер — prints.yaml, measured_tags). Словарь — данные (tags.yaml), не код:
пополнить его — правка файла, а не выкатка.

Текстовая половина модели нужна только для формулировок словаря: они
считаются один раз и держатся в памяти. На каждую картинку — только скалярные
произведения с уже готовым вектором картинки.
"""

import pathlib
import threading
from dataclasses import dataclass
from functools import lru_cache

import numpy as np
import onnxruntime as ort
import yaml
from tokenizers import Tokenizer

from reference_api.config import settings

#: Имя пишется рядом с каждым тегом. Сменится модель — сменится имя.
MODEL_NAME = "clip-vit-base-patch32/text/quantized"

_lock = threading.Lock()


@dataclass(frozen=True)
class Tag:
    code: str
    name: str
    score: float


def _paths() -> tuple[pathlib.Path, pathlib.Path, pathlib.Path]:
    cfg = settings()
    models = pathlib.Path(cfg.embedding_model_path).parent
    text = pathlib.Path(cfg.text_model_path) if cfg.text_model_path else models / "text_model_quantized.onnx"
    tok = pathlib.Path(cfg.tokenizer_path) if cfg.tokenizer_path else models / "tokenizer.json"
    return text, tok, pathlib.Path(cfg.fixtures_path) / "tags.yaml"


@lru_cache(maxsize=1)
def _vocabulary() -> tuple[dict, list[tuple[list[dict], list[np.ndarray]]]]:
    """Словарь и векторы его формулировок — раз на процесс."""
    text_path, tok_path, vocab_path = _paths()
    vocab = yaml.safe_load(vocab_path.read_text(encoding="utf-8"))
    tok = Tokenizer.from_file(str(tok_path))
    session = ort.InferenceSession(str(text_path), providers=["CPUExecutionProvider"])

    def embed_text(s: str) -> np.ndarray:
        ids = np.array([tok.encode(s).ids], dtype=np.int64)
        v = session.run(None, {"input_ids": ids})[0][0]
        return v / np.linalg.norm(v)

    groups = []
    for g in vocab["groups"]:
        mats = [np.stack([embed_text(vocab["template"].format(p)) for p in t["prompts"]]) for t in g["tags"]]
        groups.append((g["tags"], mats))
    return vocab, groups


def tag(vector: list[float]) -> list[Tag]:
    """Теги картинки по её вектору.

    В каждой группе теги сравниваются между собой; проходит самый вероятный,
    если его вероятность не ниже порога. Скрытые соперники — «белый фон»,
    «одежда» — занимают своё место в споре, но не показываются. Из тега
    следуют производные: снег — это зимняя сцена.
    """
    cfg = settings()
    with _lock:
        vocab, groups = _vocabulary()
    derived = {d["code"]: d["name"] for d in vocab.get("derived", [])}
    img = np.asarray(vector, dtype=np.float32)
    out: dict[str, Tag] = {}
    for tags, mats in groups:
        s = np.array([float((m @ img).max()) for m in mats]) * 100
        p = np.exp(s - s.max())
        p /= p.sum()
        for i in np.argsort(-p)[: cfg.tag_per_group]:
            t = tags[i]
            if p[i] < cfg.tag_probability_min or t.get("hidden"):
                continue
            out[t["code"]] = Tag(t["code"], t["name"], round(float(p[i]), 3))
            for d in t.get("implies", []):
                if d not in out or out[d].score < p[i]:
                    out[d] = Tag(d, derived.get(d, d), round(float(p[i]), 3))
    return sorted(out.values(), key=lambda t: -t.score)


def search_forms() -> list[tuple[str, str, list[str]]]:
    """(код, имя, основы слова) по всему словарю, включая производные — для
    поиска по-русски."""
    vocab, _ = _vocabulary()
    out = []
    for g in vocab["groups"]:
        for t in g["tags"]:
            if not t.get("hidden"):
                out.append((t["code"], t["name"], t.get("search", [])))
    for d in vocab.get("derived", []):
        out.append((d["code"], d["name"], d.get("search", [])))
    return out

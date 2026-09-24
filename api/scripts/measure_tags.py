"""Замер автотегов на наборе владельца и отрицательных примерах (US-0478).

Ожидания записаны в prints.yaml ДО замера. Теги соревнуются внутри своей
группы; сравниваются пороги вероятности в группе и сколько тегов группа может
дать. Считается число верных, лишних и пропущенных тегов.

    docker compose exec -T -e PYTHONPATH=/app api python scripts/measure_tags.py
"""

import pathlib

import numpy as np
import onnxruntime as ort
import yaml
from tokenizers import Tokenizer

from reference_api.services import assets
from reference_api.services.embeddings import embed

FILES = pathlib.Path("/srv/reference/files")
FIX = pathlib.Path("/srv/reference/fixtures")
MODELS = FILES / "models/clip-vit-base-patch32"

vocab = yaml.safe_load((FIX / "tags.yaml").read_text(encoding="utf-8"))
prints = yaml.safe_load((FIX / "prints.yaml").read_text(encoding="utf-8"))["files"]
derived = {d["code"]: d["name"] for d in vocab["derived"]}
# Следствия не меряются: танк — техника по определению. Ожидание «Танк»
# поэтому включает и «Технику», и «Военное» — иначе верное следствие
# считалось бы лишним тегом.
follows = {
    t["name"]: [derived[d] for d in t.get("implies", [])]
    for g in vocab["groups"] for t in g["tags"]
}


def closed(expected: set[str]) -> set[str]:
    return expected | {d for n in expected for d in follows.get(n, [])}

tok = Tokenizer.from_file(str(MODELS / "tokenizer.json"))
text = ort.InferenceSession(str(MODELS / "text_model_quantized.onnx"), providers=["CPUExecutionProvider"])


def embed_text(s: str) -> np.ndarray:
    v = text.run(None, {"input_ids": np.array([tok.encode(s).ids], dtype=np.int64)})[0][0]
    return v / np.linalg.norm(v)


groups = []
for g in vocab["groups"]:
    tags = []
    for t in g["tags"]:
        m = np.stack([embed_text(vocab["template"].format(p)) for p in t["prompts"]])
        tags.append((t, m))
    groups.append((g, tags))

cases = []
for f in prints:
    cases.append((f["name"], np.array(embed((FILES / "prints" / f["name"]).read_bytes()).vector), closed(set(f["tags_expected"]))))
for d in [
    "a7ccff40d80aef903585d44cb0c34e96aba00343b1171af11cf62a4a9e63aa32",
    "e3fb1fae2696c7e58d6d06b9d2bf49e7751aa6de5ebf432f87bea83a4dcd2bb7",
    "d84c590b7339cf09a5391ca2745899356d7b894c692a1449a13d6b18cb638277",
    "e7d51c1d24684126aaa859322f426b35335b41dc37063a7033866a0322a5121e",
    "ace6336fe12f8a7236d8d4b9b7b3dea4916d8bf8a55b64ab9b69aa403857c8b5",
]:
    c = assets.original(d)
    if c:
        cases.append((f"надпись {d[:6]}", np.array(embed(c).vector), closed({"Надпись"})))
for code in ("front", "back", "left"):
    cases.append((f"кадр {code}", np.array(embed((FILES / f"products/B-HDY-14/states/{code}.png").read_bytes()).vector), set()))


def tags_of(img: np.ndarray, p_min: float, per_group: int) -> dict[str, float]:
    out: dict[str, float] = {}
    for _, tags in groups:
        s = np.array([float((m @ img).max()) for _, m in tags]) * 100
        p = np.exp(s - s.max())
        p /= p.sum()
        for i in np.argsort(-p)[:per_group]:
            t = tags[i][0]
            if p[i] >= p_min and not t.get("hidden"):
                out[t["name"]] = float(p[i])
                for d in t.get("implies", []):
                    out[derived[d]] = max(out.get(derived[d], 0), float(p[i]))
    return out


def evaluate(p_min: float, per_group: int):
    tp = fp = fn = 0
    for _, img, expected in cases:
        got = set(tags_of(img, p_min, per_group))
        tp += len(got & expected)
        fp += len(got - expected)
        fn += len(expected - got)
    return tp, fp, fn


rows = []
for per_group in (1, 2, 3):
    for p_min in (0.1, 0.15, 0.2, 0.25, 0.3, 0.4):
        tp, fp, fn = evaluate(p_min, per_group)
        f1 = 2 * tp / (2 * tp + fp + fn) if tp else 0
        rows.append((f1, p_min, per_group, tp, fp, fn))
rows.sort(key=lambda r: -r[0])
print("лучшие настройки:")
for f1, p_min, per_group, tp, fp, fn in rows[:6]:
    print(f"  F1 {f1:.2f}  вероятность ≥ {p_min}, до {per_group} в группе: верных {tp}, лишних {fp}, пропущено {fn}")

_, p_min, per_group, *_ = rows[0]
print(f"\nпо картинкам при лучшей (≥ {p_min}, до {per_group}):")
for n, img, expected in cases:
    got = tags_of(img, p_min, per_group)
    shown = ", ".join(f"{k} {v:.2f}" for k, v in sorted(got.items(), key=lambda x: -x[1]))
    miss = sorted(expected - set(got))
    extra = sorted(set(got) - expected)
    print(f"  {n[:24]:24} {shown}" + (f"  | нет: {', '.join(miss)}" if miss else "") + (f"  | лишнее: {', '.join(extra)}" if extra else ""))

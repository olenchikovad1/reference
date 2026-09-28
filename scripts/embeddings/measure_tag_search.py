"""Замер поиска по смыслу (US-0628): запросы tag_benchmark.yaml, search_queries.

«Было» — нынешний поиск: запрос сравнивается с вектором картинки
(services/library.search, без порогов показа — мерится порядок). «Стало» —
запрос сравнивается с тегами картинки одной текстовой моделью смысла:
точное совпадение слова — выше любого похожего, иначе — наибольшая похожесть
запроса на тег картинки. Теги — те, что ставит сервис: вид решает модель
(kinds), аниме — аниме-разметчик, остальное — общая модель, сильные и слабые.

Мера по запросу — сколько ожидаемых в первой десятке (полнота) и сколько
там чужих; время ответа — на запрос, без загрузки модели.

    docker compose -f infra/compose.yaml exec -T api python -m scripts.embeddings.measure_tag_search [кандидат...]
"""

import pathlib
import sys
import time

import numpy as np
import onnxruntime as ort
import yaml
from tokenizers import Tokenizer

from reference_api.services import anime, kinds, words
from reference_api.services import tags as tagging
from reference_api.services.embeddings import embed

FILES = pathlib.Path("/srv/reference/files")
FIX = pathlib.Path("/srv/reference/fixtures")


def norm(w: str) -> str:
    return w.lower().replace("ё", "е")


class ClipText:
    name = "clip-multilingual (как теги)"

    def text(self, texts: list[str]) -> np.ndarray:
        return words.embed(texts)


class E5:
    """multilingual-e5: средний пулинг по маске, префикс «query: » у обеих
    сторон — задача симметричная, как велит карточка модели."""

    def __init__(self, folder: str, file: str) -> None:
        base = FILES / "models" / folder
        self.name = f"{folder} ({file.removesuffix('.onnx')})"
        self.s = ort.InferenceSession(str(base / file), providers=["CPUExecutionProvider"])
        self.tok = Tokenizer.from_file(str(base / "tokenizer.json"))
        self.tok.enable_padding(pad_id=1, pad_token="<pad>")
        self.tok.enable_truncation(max_length=32)
        self.inputs = {i.name for i in self.s.get_inputs()}

    def text(self, texts: list[str]) -> np.ndarray:
        out = []
        for i in range(0, len(texts), 64):
            enc = self.tok.encode_batch([f"query: {t}" for t in texts[i : i + 64]])
            ids = np.array([e.ids for e in enc], dtype=np.int64)
            mask = np.array([e.attention_mask for e in enc], dtype=np.int64)
            feeds = {"input_ids": ids, "attention_mask": mask}
            if "token_type_ids" in self.inputs:
                feeds["token_type_ids"] = np.zeros_like(ids)
            h = self.s.run(None, feeds)[0]
            m = mask[..., None].astype(np.float32)
            v = (h * m).sum(1) / np.maximum(m.sum(1), 1e-9)
            out.append(v / np.linalg.norm(v, axis=1, keepdims=True))
        return np.concatenate(out)


CANDIDATES = {
    "clip-text": lambda: ClipText(),
    "e5-small": lambda: E5("multilingual-e5-small", "model.onnx"),
    "e5-small-8": lambda: E5("multilingual-e5-small", "model_int8.onnx"),
    "e5-base-8": lambda: E5("multilingual-e5-base", "model_int8.onnx"),
}


def tags_of(name: str, vector: list[float]) -> list[tuple[str, tuple[str, ...], bool]]:
    """(показ, слова, сильный) — как сервис: маршрут вида, затем модели."""
    v = kinds.classify(vector)
    out = []
    use = kinds.taggers(v)
    if "anime" in use:
        out.append(("аниме", ("аниме",), True))
        for i, t in enumerate(anime.tag((FILES / "prints" / name).read_bytes()).tags):
            out.append((t.name, t.words, i < tagging.STRONG_MAX))
    if "general" in use:
        out += [(t.name, (t.name,), t.strong) for t in tagging.tag(vector)]
    return out


def main() -> None:
    bench = yaml.safe_load((FIX / "tag_benchmark.yaml").read_text(encoding="utf-8"))
    queries = bench["search_queries"]
    names = [i["name"] for i in bench["images"]]
    vectors = {n: embed((FILES / "prints" / n).read_bytes()).vector for n in names}
    tags = {n: tags_of(n, vectors[n]) for n in names}

    def score(rank: list[str], expected: list[str]) -> tuple[int, int]:
        top = rank[:10]
        return sum(n in expected for n in top), sum(n not in expected for n in top)

    # Было: запрос против вектора картинки.
    img = np.array([vectors[n] for n in names], dtype=np.float32)
    print(f"{'запрос':14} {'ожид':>4}  было(полн/чужих)  " + "  ".join(f"{c[:14]:>14}" for c in (sys.argv[1:] or CANDIDATES)))
    before = {}
    image_rank: dict[str, list[str]] = {}
    for q, exp in queries.items():
        s = img @ words.embed([q])[0]
        image_rank[q] = [names[i] for i in np.argsort(-s)]
        before[q] = score(image_rank[q], exp)
    # Без новой модели: картинки, у которых слово запроса — точно их тег, —
    # наверх, остальные — в порядке по картинке.
    exact_first = {}
    for q, exp in queries.items():
        hit = {n for n in names if any(norm(q) in {norm(w) for w in ws} or norm(q) == norm(t) for t, ws, _ in tags[n])}
        exact_first[q] = score(sorted(image_rank[q], key=lambda n: n not in hit), exp)
    print("точное слово тега наверху + порядок по картинке: "
          + ", ".join(f"{q} {v[0]}/{min(len(queries[q]), 10)}" for q, v in exact_first.items())
          + f"; всего {sum(v[0] for v in exact_first.values())}/{sum(min(len(e), 10) for e in queries.values())}")

    after: dict[str, dict[str, tuple[int, int]]] = {}
    timing: dict[str, float] = {}
    for c in sys.argv[1:] or CANDIDATES:
        enc = CANDIDATES[c]()
        vocab = sorted({t for ts in tags.values() for t, _, _ in ts})
        tv = dict(zip(vocab, enc.text(vocab), strict=True))
        after[c] = {}
        spent = 0.0
        for q, exp in queries.items():
            t0 = time.perf_counter()
            qv = enc.text([q])[0]
            ranked = []
            for n in names:
                best = 0.0
                for t, ws, strong in tags[n]:
                    if norm(q) in {norm(w) for w in ws} or norm(q) == norm(t):
                        best = max(best, 2.0 + (0.1 if strong else 0))
                    else:
                        best = max(best, float(tv[t] @ qv) * (1.0 if strong else 0.9))
                ranked.append((best, n))
            ranked.sort(reverse=True)
            spent += time.perf_counter() - t0
            after[c][q] = score([n for _, n in ranked], exp)
            # Слияние: сумма обратных мест в двух порядках (по картинке и по
            # тегам); точное слово тега — всё равно наверху.
            by_tag = {n: r for r, (_, n) in enumerate(ranked)}
            by_img = {n: r for r, n in enumerate(image_rank[q])}
            exact = {n for b, n in ranked if b >= 2.0}
            fused = sorted(names, key=lambda n: (n not in exact, -(1 / (10 + by_tag[n]) + 1 / (10 + by_img[n]))))
            after.setdefault(c + "+картинка", {})[q] = score(fused, exp)
        timing[c] = timing[c + "+картинка"] = spent / len(queries)

    total_b = [0, 0]
    totals = {c: [0, 0] for c in after}
    for q, exp in queries.items():
        b = before[q]
        total_b[0] += b[0]; total_b[1] += b[1]
        cells = []
        for c in after:
            a = after[c][q]
            totals[c][0] += a[0]; totals[c][1] += a[1]
            cells.append(f"{a[0]:>2}/{min(len(exp), 10):<2} чуж {a[1]:>2}")
        print(f"{q:14} {len(exp):4}  {b[0]:>2}/{min(len(exp), 10):<2} чуж {b[1]:>2}      " + "  ".join(f"{x:>14}" for x in cells))
    want = sum(min(len(e), 10) for e in queries.values())
    print(f"{'всего':14} {want:4}  {total_b[0]:>2}/{want} чуж {total_b[1]:>3}    "
          + "  ".join(f"{t[0]:>3}/{want} чуж {t[1]:>3}" for t in totals.values()))
    print("время ответа, мс на запрос: " + ", ".join(f"{c} {timing[c] * 1000:.0f}" for c in after))


if __name__ == "__main__":
    main()

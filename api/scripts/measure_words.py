"""Замер: двадцать тегов по весам из словаря языка (US-0482).

Ожидания — те же tags_expected из prints.yaml, записанные до замера US-0478,
в словарной форме. Набор: восемь принтов, две надписи, кадр белой худи.
Считается, сколько ожидаемого попало в сильные и в двадцатку, сколько нет
вовсе, верен ли первый тег, и сколько слов-групп людей всплывает без
исключения.

Способы вытащить сцену («снег», «зима», «лес»), которую предмет забивает:
- остаток: из вектора картинки вычитается проекция на самое сильное слово,
  веса пересчитываются по остатку, десять тегов берутся оттуда;
- жадное вычитание: двадцать шагов, на каждом берётся самое сильное слово и
  его направление вычитается из остатка.

    docker compose cp ../api/scripts/measure_words.py api:/tmp/measure_words.py
    MSYS_NO_PATHCONV=1 docker compose exec -T -e PYTHONPATH=/app api python /tmp/measure_words.py
"""

import pathlib

import numpy as np
import yaml

from reference_api.config import settings
from reference_api.services import assets, words
from reference_api.services import tags as tagging
from reference_api.services.embeddings import embed as embed_image

FILES = pathlib.Path("/srv/reference/files")
FIX = pathlib.Path("/srv/reference/fixtures")
prints = yaml.safe_load((FIX / "prints.yaml").read_text(encoding="utf-8"))["files"]

# Словарная форма ожидаемых тегов: в словаре «вертолет», а не «вертолёт».
FORM = {"Танк": "танк", "Снег": "снег", "Зима": "зима", "Лес": "лес", "Горы": "гора",
        "Небо": "небо", "Вертолёт": "вертолет", "Огонь": "огонь", "Дым": "дым",
        "Камуфляж": "камуфляж", "Надпись": "надпись"}
SCENE = {"снег", "зима", "лес", "гора", "небо", "дым", "огонь"}

cases = []
for f in prints:
    img = np.array(embed_image((FILES / "prints" / f["name"]).read_bytes()).vector, dtype=np.float32)
    cases.append((f["subject"], img, {FORM[t] for t in f["tags_expected"]}))
for d in ["a7ccff40d80aef903585d44cb0c34e96aba00343b1171af11cf62a4a9e63aa32",
          "e3fb1fae2696c7e58d6d06b9d2bf49e7751aa6de5ebf432f87bea83a4dcd2bb7"]:
    c = assets.original(d)
    if c:
        cases.append((f"надпись {d[:4]}", np.array(embed_image(c).vector, dtype=np.float32), {"надпись"}))
cases.append(("худи front", np.array(embed_image((FILES / "products/B-HDY-14/states/front.png").read_bytes()).vector,
                                     dtype=np.float32), {"толстовка"}))
TOTAL = sum(len(e) for _, _, e in cases)
SCENE_TOTAL = sum(len(e & SCENE) for _, _, e in cases)

cfg = settings()
excluded = tagging.excluded()


class Vocab:
    def __init__(self, limit: int, drop: bool) -> None:
        self.words, self.W = words.vocabulary(limit, cfg.tag_template)
        self.keep = np.array([not (drop and w in excluded) for w in self.words])
        self.pos = {w: i for i, w in enumerate(self.words)}

    def weights(self, v, mask=None):
        s = self.W @ (v / np.linalg.norm(v))
        s = np.where(self.keep if mask is None else mask, s, -np.inf)
        p = np.exp((s - s.max()) * 100)
        return p / p.sum()

    def plain(self, v):
        p = self.weights(v)
        return [(self.words[i], float(p[i])) for i in np.argsort(-p)[:20]]

    def residual(self, v):
        """Десять из основной выдачи, десять — из остатка после вычитания
        самого сильного слова. Вес у тегов остатка — их вес в остатке."""
        main = self.plain(v)
        t = self.W[self.pos[main[0][0]]]
        p = self.weights(v - (v @ t) * t)
        out, seen = main[:10], {w for w, _ in main[:10]}
        for i in np.argsort(-p):
            if len(out) == 20:
                break
            if self.words[i] not in seen:
                out.append((self.words[i], float(p[i])))
        return out

    def pursuit(self, v):
        r, m, out = v.copy(), self.keep.copy(), []
        for _ in range(20):
            p = self.weights(r, m)
            i = int(np.argmax(p))
            out.append((self.words[i], float(p[i])))
            m[i] = False
            r = r - (r @ self.W[i]) * self.W[i]
        return out


def strong_of(tags, share):
    top = tags[0][1]
    return {w for k, (w, s) in enumerate(tags) if k < tagging.STRONG_MAX and s >= top * share}


def score(method, share):
    r = dict(strong=0, top20=0, first=0, n_strong=0, extra_strong=0, scene=0)
    for _, v, exp in cases:
        tags = method(v)
        top, st = {w for w, _ in tags}, strong_of(tags, share)
        r["top20"] += len(exp & top)
        r["strong"] += len(exp & st)
        r["first"] += tags[0][0] in exp
        r["n_strong"] += len(st)
        r["extra_strong"] += len(st - exp)
        r["scene"] += len(exp & SCENE & top)
    return r


def row(label, r):
    # F1 по сильным — та же мера, что у закрытого словаря (measured_tags):
    # верные — ожидаемые среди сильных, лишние — сильные сверх ожидаемого,
    # пропущенные — ожидаемые, не попавшие в сильные.
    f1 = 2 * r["strong"] / (r["n_strong"] + TOTAL)
    print(f"  {label:34} {r['strong']:5} {r['top20']:4} {TOTAL - r['top20']:4} {r['first']:6} {r['n_strong']:8}"
          f" {r['extra_strong']:7} {r['scene']:6} {f1:5.2f}")


HEAD = f"  {'':34} сильн  в20  нет  первый  сильных  лишних  сцена    F1"
full = Vocab(10**6, drop=False)
print(f"набор: {len(cases)} картинок, ожидаемых тегов {TOTAL}, из них сцены {SCENE_TOTAL};"
      f" слов в словаре {len(full.words)}, исключено {sum(w in excluded for w in full.words)}")

plain_at = Vocab(cfg.tag_words, drop=False)
for label, vb in [("весь словарь", full), (f"первые {cfg.tag_words}", plain_at)]:
    hits: dict[str, list[str]] = {}
    for name, v, _ in cases:
        for w, _ in vb.plain(v):
            if w in excluded:
                hits.setdefault(w, []).append(name)
    print(f"\nбез исключения слов-групп в двадцатках ({label}): {sum(len(x) for x in hits.values())} раз,"
          f" разных {len(hits)}: {', '.join(sorted(hits))}")

share = cfg.tag_strong_share
print(f"\nспособы, первые {cfg.tag_words} слов, доля сильных {share}:\n{HEAD}")
V = Vocab(cfg.tag_words, drop=True)
row("как есть", score(plain_at.plain, share))
row("с исключением", score(V.plain, share))
row("остаток после первого слова", score(V.residual, share))
row("жадное вычитание", score(V.pursuit, share))

print("\nместа ожидаемой сцены в полном ранжировании (из", len(V.words), "слов):")
for name, v, exp in cases:
    p = V.weights(v)
    order = np.argsort(-p)
    rank = {V.words[i]: r for r, i in enumerate(order)}
    got = {w: rank[w] for w in sorted(exp & SCENE)}
    if got:
        print(f"  {name[:12]:12} {got}")

print(f"\nчисло слов словаря по частоте, с исключением, доля {share}:\n{HEAD}")
by_limit = {}
for limit in (3000, 5000, 10000, 10**6):
    by_limit[limit] = Vocab(limit, drop=True)
    row(f"первые {limit if limit < 10**6 else 'все'}", score(by_limit[limit].plain, share))

chosen = by_limit[min(cfg.tag_words, 10**6)] if cfg.tag_words in by_limit else Vocab(cfg.tag_words, drop=True)
print(f"\nдоля сильных при {cfg.tag_words} словах:\n{HEAD}")
for sh in (0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5):
    row(f"доля {sh}", score(chosen.plain, sh))

for label, method in [("выдача при настройках", chosen.plain), ("остаток", V.residual),
                      ("жадное вычитание", V.pursuit)]:
    print(f"\n{label}:")
    for name, v, exp in cases:
        tags = method(v)
        st = strong_of(tags, share)
        shown = ", ".join(f"{'*' if w in st else ''}{w} {s:.4f}" for w, s in tags)
        miss = sorted(exp - {w for w, _ in tags})
        print(f"  {name[:12]:12} {shown}" + (f"  | нет: {', '.join(miss)}" if miss else ""))

# Та же выдача через сервис: замер обязан мерить то, что стоит в коде.
print("\nсервис tags.tag() совпадает с «выдачей при настройках»:",
      all([(t.name, round(t.score, 6)) for t in tagging.tag(list(map(float, v)))]
          == [(w, round(s, 6)) for w, s in chosen.plain(v)] for _, v, _ in cases))

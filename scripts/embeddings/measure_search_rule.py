"""Замер выдачи поиска так, как её отдаёт сервис (US-0628): с порогами веса,
точным тегом наверху — и с проверенной, но не принятой добавкой: находками
по смыслу тега (multilingual-e5-small). Добавки в сервисе нет: при пороге,
где чужих не больше своих, она давала +2 находки из 58 (tag_benchmark.yaml,
measured_search). Правило порядка поэтому живёт здесь, а не в сервисе.

Запросы — tag_benchmark.yaml, search_queries; библиотека — картинки эталона.
Теги — как ставит сервис (scripts/embeddings/measure_tag_search.tags_of).
Перебирается порог похожести тега (search_tag_min): «0» в таблице — без
поиска по смыслу тега, то есть выдача до US-0628 с точным тегом наверху.

    docker compose -f infra/compose.yaml exec -T api python -m scripts.embeddings.measure_search_rule
"""

import pathlib
import statistics

import numpy as np
import yaml

from reference_api.config import settings
from reference_api.services import words
from reference_api.services.embeddings import embed
from scripts.embeddings.measure_tag_search import CANDIDATES, norm, tags_of

FILES = pathlib.Path("/srv/reference/files")
FIX = pathlib.Path("/srv/reference/fixtures")


def order(weighed, exact, near, tag_min, show_weight, limit, image_found):
    """Точный тег наверху; дальше — по картинке (если выдача по картинке
    прошла порог «нашлось») и по смыслу тега вместе, по сумме обратных мест."""
    by_tag = [r for r in weighed if r[0] in exact]
    rest = [r for r in weighed if r[0] not in exact]
    img_place = {r[0]: i for i, r in enumerate(rest)}
    near_place = {r[0]: i for i, r in enumerate(sorted((r for r in rest if r[0] in near), key=lambda r: -near[r[0]][1]))}
    picked = [r for r in rest if (image_found and r[3] >= show_weight) or (r[0] in near and near[r[0]][1] >= tag_min)]
    picked.sort(key=lambda r: -(1 / (10 + img_place[r[0]]) + 1 / (10 + near_place.get(r[0], len(rest)))))
    return (by_tag + picked)[: max(limit, len(by_tag))]


def main() -> None:
    cfg = settings()
    bench = yaml.safe_load((FIX / "tag_benchmark.yaml").read_text(encoding="utf-8"))
    queries = bench["search_queries"]
    names = [i["name"] for i in bench["images"]]
    vectors = {n: embed((FILES / "prints" / n).read_bytes()).vector for n in names}
    tags = {n: tags_of(n, vectors[n]) for n in names}
    img = np.array([vectors[n] for n in names], dtype=np.float32)
    e5 = CANDIDATES["e5-small"]()
    vocab = sorted({t for ts in tags.values() for t, _, _ in ts})
    tv = dict(zip(vocab, e5.text(vocab), strict=True))

    rows: dict[float, list[tuple[int, int, int]]] = {}
    for thr in (0.0, 0.84, 0.85, 0.86, 0.87, 0.88, 0.90):
        for q, exp in queries.items():
            s = img @ words.embed([cfg.search_template.format(q)])[0]
            mean, spread = statistics.fmean(s.tolist()), statistics.pstdev(s.tolist())
            weighed = sorted(((n, n, float(x), (float(x) - mean) / spread) for n, x in zip(names, s, strict=True)),
                             key=lambda r: -r[3])
            exact = {n: t for n in names for t, ws, _ in tags[n] if norm(q) in {norm(w) for w in ws} or norm(q) == norm(t)}
            qv = e5.text([q])[0]
            near = {}
            for n in names:
                c = [(t, float(tv[t] @ qv) * (1.0 if st else 0.9)) for t, _, st in tags[n]]
                if c:
                    near[n] = max(c, key=lambda x: x[1])
            use_near = near if thr > 0 else {}
            strong_near = any(v >= thr for _, v in use_near.values()) if thr > 0 else False
            if not exact and not strong_near and weighed[0][3] < cfg.search_min_weight:
                shown = []
            else:
                shown = [r[0] for r in order(weighed, exact, use_near, thr or 9.0, cfg.search_show_weight,
                                             cfg.search_limit, weighed[0][3] >= cfg.search_min_weight)]
            top = shown[:10]
            rows.setdefault(thr, []).append((sum(n in exp for n in top), len(top), sum(n not in exp for n in top)))

    want = sum(min(len(e), 10) for e in queries.values())
    print(f"  {'порог тега':10} {'нашлось':>9} {'показано':>8} {'чужих':>6}   по запросам (нашлось/показано)")
    for thr, r in rows.items():
        per = ", ".join(f"{q} {h}/{s}" for q, (h, s, _) in zip(queries, r, strict=True))
        print(f"  {('нет' if thr == 0 else thr):>10} {sum(x[0] for x in r):4}/{want:<4} {sum(x[1] for x in r):8} "
              f"{sum(x[2] for x in r):6}   {per}")


if __name__ == "__main__":
    main()

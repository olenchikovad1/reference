"""Замер к US-0480: по какому правилу поиск словом говорит «нашлось» и «ничего».

Абсолютного порога у похожести слова и картинки нет (замер US-0482: «кот» даёт
ИС-3 с 0.233, «снег» снежному танку — 0.26). Поэтому сравниваются правила,
которые меряют картинку относительно остальных на тот же запрос:
- abs — похожесть не ниже порога;
- z — насколько картинка выше среднего по библиотеке в стандартных отклонениях;
- gap — отрыв от медианы по библиотеке.

Положительные пары — слова поиска из описания набора (`search_expected` набора
настройки, `tags_expected` принтов владельца, группы `tuning_search_groups`),
записанные до замера. Отрицательные запросы — понятия, которых в наборе нет:
на них правило обязано ответить «ничего».

Где: контейнер api:

    docker compose -f infra/compose.yaml exec -T api python -m scripts.embeddings.search_rule
"""

import pathlib

import numpy as np
import yaml

from reference_api.services import words
from reference_api.services.embeddings import embed

PRINTS = pathlib.Path("/srv/reference/files/prints")
FIX = pathlib.Path("/srv/reference/fixtures")
#: Чего в наборе нет ни на одной картинке — проверено по листу миниатюр.
ABSENT = ["жираф", "кит", "велосипед", "скрипка", "компьютер", "пианино", "слон", "поезд",
          "чашка", "зонт", "очки", "лампа", "книга", "дерево пальма", "верблюд", "часы"]


TEMPLATES = ["{}", "фото: {}", "картинка, на которой {}", "изображение {}"]


def ranking(fx: dict, names: list[str], imgs: np.ndarray, positives: dict[str, set[str]]) -> None:
    """Выдача упорядочена по весу, а «ничего» — решение о запросе целиком:
    меряется место ожидаемой картинки и то, отделяет ли лучший вес запроса
    настоящие запросы от отсутствующих. Для нескольких шаблонов фразы."""
    for tpl in TEMPLATES:
        qs = sorted(positives)
        q = words.embed([tpl.format(w) for w in qs + ABSENT])
        sims = q @ imgs.T
        z = (sims - sims.mean(1, keepdims=True)) / sims.std(1, keepdims=True)
        at1 = at3 = total = 0
        for i, w in enumerate(qs):
            order = list(np.argsort(-sims[i]))
            for n in positives[w]:
                r = order.index(names.index(n))
                total += 1
                at1 += r == 0 or (r < len(positives[w]) and names[order[r]] in positives[w])
                at3 += r < max(3, len(positives[w]))
        top_pos = np.sort(z[:len(qs)].max(1))
        top_neg = np.sort(z[len(qs):].max(1))
        # Разделимость: доля пар (настоящий, отсутствующий), где у настоящего лучший вес выше.
        auc = float((top_pos[:, None] > top_neg[None, :]).mean())
        cut = float(top_neg.max())
        kept = float((top_pos > cut).mean())
        print(f"«{tpl}»: ожидаемая в своих первых местах {at1/total:.2f}, в тройке {at3/total:.2f}; "
              f"лучший z настоящих выше отсутствующих в {auc:.2f} пар; "
              f"при отсечке по худшему отсутствующему (z>{cut:.2f}) остаются {kept:.2f} запросов")


def tiles(data: bytes) -> list[bytes]:
    """Картинка целиком плюс сетка 3×3 кусков с перекрытием: деталь с края
    (белка у рамки крейсера) в векторе целой картинки тонет, в своём куске — нет."""
    import io

    from PIL import Image

    out = [data]
    with Image.open(io.BytesIO(data)) as im:
        im = im.convert("RGBA")
        w, h = im.size
        cw, ch = w // 2, h // 2
        for gy in range(3):
            for gx in range(3):
                x0, y0 = gx * (w - cw) // 2, gy * (h - ch) // 2
                buf = io.BytesIO()
                im.crop((x0, y0, x0 + cw, y0 + ch)).save(buf, format="PNG")
                out.append(buf.getvalue())
    return out


def by_tiles(names: list[str], positives: dict[str, set[str]], tpl: str) -> None:
    """То же, что ranking, но вес картинки — лучший из её кусков."""
    vecs = []
    for n in names:
        v = np.stack([np.asarray(embed(b).vector, dtype=np.float32) for b in tiles((PRINTS / n).read_bytes())])
        vecs.append(v / np.linalg.norm(v, axis=1, keepdims=True))
    qs = sorted(positives)
    q = words.embed([tpl.format(w) for w in qs + ABSENT])
    sims = np.stack([(q @ v.T).max(1) for v in vecs], axis=1)
    z = (sims - sims.mean(1, keepdims=True)) / sims.std(1, keepdims=True)
    at1 = at3 = total = 0
    for i, w in enumerate(qs):
        order = list(np.argsort(-sims[i]))
        for n in positives[w]:
            r = order.index(names.index(n))
            total += 1
            at1 += r == 0 or (r < len(positives[w]) and names[order[r]] in positives[w])
            at3 += r < max(3, len(positives[w]))
    top_pos, top_neg = z[:len(qs)].max(1), z[len(qs):].max(1)
    auc = float((top_pos[:, None] > top_neg[None, :]).mean())
    print(f"куски, «{tpl}»: ожидаемая в своих первых местах {at1/total:.2f}, в тройке {at3/total:.2f}; "
          f"разделимость запросов {auc:.2f}")
    for w in ["белка", "шишки", "хвоя", "гирлянда", "новый год", "ёлка", "надпись", "снег", "жираф"]:
        i = (qs + ABSENT).index(w) if w in qs + ABSENT else None
        if i is None:
            continue
        o = np.argsort(-sims[i])[:3]
        print(f"    {w:10} " + ", ".join(f"{names[j][:-4]} {z[i, j]:.1f}" for j in o))


def main() -> None:
    fx = yaml.safe_load((FIX / "prints.yaml").read_text(encoding="utf-8"))
    entries = fx["files"] + fx["tuning_set"]
    names = [e["name"] for e in entries]
    imgs = np.stack([np.asarray(embed((PRINTS / n).read_bytes()).vector, dtype=np.float32) for n in names])
    imgs /= np.linalg.norm(imgs, axis=1, keepdims=True)

    positives: dict[str, set[str]] = {}
    for e in entries:
        for w in e.get("search_expected") or [t.lower() for t in e.get("tags_expected", [])]:
            positives.setdefault(w, set()).add(e["name"])
    for w, group in fx.get("tuning_search_groups", {}).items():
        positives.setdefault(w, set()).update(group)
    print("=== выдача по весу и «ничего» по запросу целиком")
    ranking(fx, names, imgs, positives)
    by_tiles(names, positives, "фото: {}")
    print()
    queries = sorted(positives) + ABSENT
    q = words.embed(queries)
    sims = q @ imgs.T                                   # запрос × картинка

    mean, std, med = sims.mean(1, keepdims=True), sims.std(1, keepdims=True), np.median(sims, 1, keepdims=True)
    scores = {"abs": sims, "z": (sims - mean) / std, "gap": sims - med}
    grids = {"abs": np.arange(0.20, 0.32, 0.005), "z": np.arange(1.0, 4.01, 0.1), "gap": np.arange(0.01, 0.08, 0.0025)}

    print(f"картинок {len(names)}, запросов с ожиданием {len(positives)}, отрицательных {len(ABSENT)}\n")
    best = {}
    for rule, sc in scores.items():
        rows = []
        for t in grids[rule]:
            hit = sc >= t
            tp = sum(hit[i, names.index(n)] for i, w in enumerate(queries) if w in positives for n in positives[w])
            need = sum(len(positives[w]) for w in positives)
            fp_pos = sum(hit[i, j] for i, w in enumerate(queries) if w in positives
                         for j, n in enumerate(names) if n not in positives[w])
            empty_neg = sum(not hit[i].any() for i, w in enumerate(queries) if w in ABSENT)
            recall, prec = tp / need, tp / max(1, tp + fp_pos)
            rows.append((recall * prec * empty_neg / len(ABSENT), t, recall, prec, empty_neg))
        rows.sort(reverse=True)
        best[rule] = rows[0]
        _, t, r, p, e = rows[0]
        print(f"{rule:4} лучший порог {t:.3f}: найдено ожидаемого {r:.2f}, точность {p:.2f}, "
              f"пустых на отсутствующем {e} из {len(ABSENT)}")

    rule = max(best, key=lambda k: best[k][0])
    t = best[rule][1]
    print(f"\nлучшее правило: {rule} ≥ {t:.3f}\n")
    sc = scores[rule]
    for i, w in enumerate(queries):
        order = np.argsort(-sc[i])
        top = [(names[j], sc[i, j]) for j in order[:4] if sc[i, j] >= t]
        exp = positives.get(w, set())
        mark = "ОТСУТСТВУЕТ" if w in ABSENT else f"ждём {len(exp)}"
        shown = ", ".join(f"{'✓' if n in exp else '·'}{n.removesuffix('.png')} {s:.2f}" for n, s in top) or "ничего"
        print(f"  {w:14} [{mark}] → {shown}")


if __name__ == "__main__":
    main()

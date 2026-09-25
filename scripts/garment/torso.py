#!/usr/bin/env python3
"""Объём торса по силуэтам кадров: ширина с переда и спины, глубина с бока.

Раздел `torso` описания изделия снят так (24.09.2026, план 069): торс —
эллиптический цилиндр; ширина — по кадрам переда и спины ниже рукавов, где
торс и рукава в строке уже разделены просветом; глубина — по боковому кадру
построчно, а передний край на высоте манжеты, торчащей вперёд, интерполирован
между соседними строками. Скрипт повторяет замер и сверяет с описанием.

Где: хост, стандартная библиотека и PyYAML:

    py scripts/garment/torso.py [КОД_ИЗДЕЛИЯ]
"""

import pathlib
import statistics
import sys

import yaml

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import rgba_png  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[2]
FILES = ROOT / "infra/stand/files"
FIXTURES = ROOT / "infra/stand/fixtures"

#: Ниже рукавов: здесь в строке либо один торс, либо торс между двумя рукавами.
BELOW_SLEEVES = range(440, 581, 20)
#: Манжета бокового кадра торчит вперёд — передний край здесь не торс.
CUFF = (380, 500)


def opaque_xs(px: bytes, w: int, y: int) -> list[int]:
    return [x for x in range(w) if rgba_png.opaque(px, w, x, y)]


def runs(xs: list[int]) -> list[tuple[int, int]]:
    """Куски строки: торс и рукава отдельны, если между ними просвет больше 2 px."""
    out, start = [], None
    for i, x in enumerate(xs):
        if start is None:
            start = x
        if i + 1 == len(xs) or xs[i + 1] - x > 2:
            out.append((start, x))
            start = None
    return out


def hem(px: bytes, w: int, h: int, contiguous: bool, ys: range) -> int | None:
    """Низ торса — последняя строка шире 100 px; у переда и спины ещё и без
    разрывов, иначе за подол сойдёт строка со свисающими рукавами."""
    found = None
    for y in ys:
        if y >= h:
            break
        xs = opaque_xs(px, w, y)
        if xs and xs[-1] - xs[0] > 100 and (not contiguous or len(runs(xs)) == 1):
            found = y
    return found


def facing(px: bytes, w: int, h: int, centre_hint: int) -> dict:
    lefts, rights = [], []
    for y in BELOW_SLEEVES:
        if y >= h:
            continue
        pieces = runs(opaque_xs(px, w, y))
        torso = [r for r in pieces if r[0] <= centre_hint <= r[1]]
        if torso and torso[0][1] - torso[0][0] < 300:
            lefts.append(torso[0][0])
            rights.append(torso[0][1])
    left, right = statistics.median(lefts), statistics.median(rights)
    return {"centre_x": (left + right) / 2, "half_px": (right - left) / 2,
            "hem_y": hem(px, w, h, True, range(400, h))}


def side(px: bytes, w: int, h: int) -> dict:
    rows = []
    for y in range(220, 600, 20):
        xs = opaque_xs(px, w, y)
        rows.append([y, xs[0], xs[-1]])
    before = [r for r in rows if r[0] <= CUFF[0]][-1]
    after = [r for r in rows if r[0] >= CUFF[1]][0]
    for r in rows:
        if CUFF[0] < r[0] < CUFF[1]:
            k = (r[0] - before[0]) / (after[0] - before[0])
            r[1] = round(before[1] + k * (after[1] - before[1]))
    return {"hem_y": hem(px, w, h, False, range(560, 620)), "rows": rows}


def main() -> None:
    code = sys.argv[1] if len(sys.argv) > 1 else "B-HDY-14"
    product = yaml.safe_load((FIXTURES / f"{code}.yaml").read_text(encoding="utf-8"))
    views = (product.get("torso") or {}).get("views", {})
    for st in product["states"]:
        w, h, px = rgba_png.read(FILES / st["frame"]["path"])
        want = views.get(st["code"], {})
        got = side(px, w, h) if st["code"] in ("left", "right") else facing(px, w, h, w // 2)
        print(f"=== {st['code']}")
        for k, v in got.items():
            same = want.get(k) == v
            shown = v if k != "rows" else f"{len(v)} строк"
            print(f"    {k}: {shown} — {'совпало' if same else f'РАСХОДИТСЯ, в описании {want.get(k)}'}")


if __name__ == "__main__":
    main()

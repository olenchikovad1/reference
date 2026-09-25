#!/usr/bin/env python3
"""Силуэт кадров изделия: границы, профиль ширины, место плеч — и отладочная
картинка с сеткой, по которой ориентиры читаются глазом.

Ориентиры ставятся не на глаз по описанию, а по измеримым признакам силуэта:
низ подола — самая нижняя непрозрачная строка, плечи — там, где ширина резко
растёт от корпуса к рукавам. Так сняты `silhouette` и ориентиры в описании
B-HDY-14 (23.09.2026); скрипт сверяет с ними и говорит, если разошлось, —
расхождение повод разбираться, а не переписывать описание.

Где: хост, стандартная библиотека и PyYAML. Из корня репозитория:

    py scripts/garment/silhouette.py [КОД_ИЗДЕЛИЯ] [--out ПАПКА]

Сетки кладутся в --out (по умолчанию временная папка системы).
"""

import argparse
import pathlib
import sys
import tempfile

import yaml

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import rgba_png  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[2]
FILES = ROOT / "infra/stand/files"
FIXTURES = ROOT / "infra/stand/fixtures"


def profile(w: int, h: int, px: bytes) -> list[tuple[int | None, int | None, int]]:
    """По каждой строке: левый и правый край непрозрачного и его ширина."""
    rows = []
    for y in range(h):
        xs = [x for x in range(w) if rgba_png.opaque(px, w, x, y)]
        rows.append((xs[0], xs[-1], len(xs)) if xs else (None, None, 0))
    return rows


def grid(w: int, h: int, px: bytes) -> bytes:
    """Кадр на тёмном фоне с сеткой через 50 px (каждая сотая — ярче)."""
    dbg = bytearray(px)
    for y in range(h):
        for x in range(w):
            i = (y * w + x) * 4
            if dbg[i + 3] == 0:
                dbg[i:i + 4] = bytes((40, 40, 40, 255))
            if x % 50 == 0 or y % 50 == 0:
                dbg[i:i + 4] = bytes((255, 80, 80, 255)) if (x % 100 == 0 or y % 100 == 0) \
                    else bytes((90, 90, 120, 255))
    return bytes(dbg)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("code", nargs="?", default="B-HDY-14")
    ap.add_argument("--out", type=pathlib.Path, default=pathlib.Path(tempfile.gettempdir()))
    args = ap.parse_args()
    product = yaml.safe_load((FIXTURES / f"{args.code}.yaml").read_text(encoding="utf-8"))

    for st in product["states"]:
        path = FILES / st["frame"]["path"]
        w, h, px = rgba_png.read(path)
        rows = profile(w, h, px)
        ys = [y for y, r in enumerate(rows) if r[2] > 0]
        top, bottom = ys[0], ys[-1]
        jumps = sorted(((rows[y + 10][2] - rows[y][2], y) for y in range(top + 5, bottom - 5)
                        if rows[y][2] and rows[y + 10][2]), reverse=True)

        print(f"=== {st['code']}  {w}x{h}")
        got = {"top": top, "bottom": bottom, "height_px": bottom - top + 1}
        want = st.get("silhouette") or {}
        verdict = "совпало с описанием" if all(want.get(k) == v for k, v in got.items()) \
            else f"РАСХОДИТСЯ с описанием {want}"
        print(f"    силуэт: строки {top}..{bottom}, высота {got['height_px']} — {verdict}")
        print(f"    самый резкий прирост ширины: строка {jumps[0][1]} (+{jumps[0][0]} px за 10 строк)")
        for frac in (0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9):
            y = int(top + (bottom - top) * frac)
            x0, x1, n = rows[y]
            print(f"    {int(frac * 100):3d}% высоты, строка {y:3d}: x {x0}..{x1}, ширина {n}")
        out = args.out / f"grid_{args.code}_{st['code']}.png"
        rgba_png.write(out, w, h, grid(w, h, px))
        print(f"    сетка: {out}")


if __name__ == "__main__":
    main()

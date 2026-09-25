#!/usr/bin/env python3
"""Вырезан ли принт: доля прозрачного и где она лежит.

Отличает вырезанный силуэт (прозрачно больше половины кадра) от сцены с мягким
краем (прозрачна только рамка по периметру). 23.09.2026 так увидели, что у
танков владельца фон не вырезан, — `caveats` в описании набора. Для стенда
это важно: принт со сценой ложится на изделие прямоугольником.

Где: хост, стандартная библиотека:

    py scripts/prints/alpha.py [ФАЙЛ.png ...]    # без аргументов — весь набор
"""

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import rgba_png  # noqa: E402

PRINTS = pathlib.Path(__file__).resolve().parents[2] / "infra/stand/files/prints"


def report(path: pathlib.Path) -> None:
    w, h, px = rgba_png.read(path)
    clear = [px[i * 4 + 3] == 0 for i in range(w * h)]
    # Внутренняя половина кадра: у сцены с виньеткой она почти вся непрозрачна.
    x0, x1, y0, y1 = w // 4, 3 * w // 4, h // 4, 3 * h // 4
    inner = [clear[y * w + x] for y in range(y0, y1) for x in range(x0, x1)]
    share, inner_share = sum(clear) / len(clear), sum(inner) / len(inner)
    kind = "вырезан" if inner_share > 0.2 else "сцена, фон не вырезан" if share < 0.5 else "неясно"
    print(f"{path.name:36} {w}x{h}  прозрачно {share * 100:5.1f} %, в центре {inner_share * 100:5.1f} %  — {kind}")


if __name__ == "__main__":
    files = [pathlib.Path(a) for a in sys.argv[1:]] or sorted(PRINTS.glob("*.png"))
    for f in files:
        report(f)

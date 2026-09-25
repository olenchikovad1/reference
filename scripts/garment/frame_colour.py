#!/usr/bin/env python3
"""Годится ли кадр в карту освещения: обесцвечен ли он и насколько гладок.

На этом замере стоит решение 0001 (23.09.2026): кадр из VStitcher обесцвечен —
насыщенность ровно 0, яркость внутри изделия 56–245, соседние пиксели
отличаются в среднем на 2.9 уровня, уменьшение вдвое и обратно теряет
2.0–2.6 % диапазона. Отсюда «цвет накладывается умножением» и «карту освещения
можно поднять до рабочего разрешения почти без потерь». Новый кадр, новое
изделие — сначала сюда: цветной или шумный кадр этот путь ломает.

Где: хост, стандартная библиотека и PyYAML:

    py scripts/garment/frame_colour.py [КОД_ИЗДЕЛИЯ]
"""

import math
import pathlib
import sys

import yaml

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import rgba_png  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[2]

#: Внутри изделия — только полностью непрозрачное: край сглажен и врёт.
INSIDE = 250


def measure(path: pathlib.Path) -> None:
    w, h, px = rgba_png.read(path)
    inside = [i for i in range(w * h) if px[i * 4 + 3] > INSIDE]
    grey = sum(1 for i in inside if px[i * 4] == px[i * 4 + 1] == px[i * 4 + 2])
    luma = [px[i * 4] for i in inside]
    ok = set(inside)
    deltas = []
    for i in inside:
        if i + 1 in ok and (i + 1) % w:
            deltas.append(abs(px[i * 4] - px[(i + 1) * 4]))
        if i + w in ok:
            deltas.append(abs(px[i * 4] - px[(i + w) * 4]))
    # Вдвое меньше и обратно: сколько деталей выше половины разрешения.
    f, dw, dh = 2, w // 2, h // 2
    small = [sum(px[((y * f + j) * w + x * f + k) * 4] for j in range(f) for k in range(f)) / 4
             for y in range(dh) for x in range(dw)]
    err = [px[i * 4] - small[min(dh - 1, (i // w) // f) * dw + min(dw - 1, (i % w) // f)] for i in inside]
    rms = math.sqrt(sum(e * e for e in err) / len(err))
    print(f"=== {path.name}: внутри изделия {len(inside)} px")
    print(f"    серых (R=G=B): {grey / len(inside) * 100:.2f} %   яркость {min(luma)}–{max(luma)}")
    print(f"    соседи отличаются в среднем на {sum(deltas) / len(deltas):.2f} уровня")
    print(f"    вдвое и обратно: теряется {rms / 255 * 100:.2f} % диапазона")


if __name__ == "__main__":
    code = sys.argv[1] if len(sys.argv) > 1 else "B-HDY-14"
    product = yaml.safe_load((ROOT / f"infra/stand/fixtures/{code}.yaml").read_text(encoding="utf-8"))
    for st in product["states"]:
        measure(ROOT / "infra/stand/files" / st["frame"]["path"])

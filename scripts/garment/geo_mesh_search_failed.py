#!/usr/bin/env python3
"""НЕ ДАЛ РЕЗУЛЬТАТА (23.09.2026) — лежит, чтобы не пробовать в третий раз.

Итог: самые длинные участки правдоподобных float дают одинаковый габарит по
всем трём осям (131.9 x 131.9 x 131.9), а одежда не куб — найден не массив
координат. Лекала в garment.vsgx (блоки offsetMap_cm) и info.dat тоже не дали
чисел. Меш изделия из .bw не достаётся; нужен экспорт из VStitcher в открытом
формате (решение 0001, повод пересмотра).

Поиск габарита изделия в снимке симуляции .geo.gcs.

Формат закрытый. Но меш — это длинный массив троек float, и у него узнаваемая
статистика: подряд идущие значения лежат в правдоподобном диапазоне координат и
плавно меняются. Ищем самый длинный такой участок и берём его габарит.

Проверка на здравый смысл названа заранее, до запуска: для 164-го размера
высота изделия обязана выйти шесть-восемь десятков сантиметров. Выйдет 0.7 или
700 — значит нашли не то либо единица другая; выйдет каша — значит не нашли.
"""
import pathlib
import struct
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import bw_source  # noqa: E402

# Где: хост, нужен zstd (см. bw_source.py). py scripts/garment/geo_mesh_search_failed.py
SNAPSHOTS = {
    98: "snapshot/cb5543f8-5fb6-11ef-a1c8-d85ed3a52585@0#98#1#take 001_pose_0#hash#9b4158316c3b7a81ce4cd585a9769666.geo.gcs",
    134: "snapshot/ba52bc6c-d8be-11ef-9dde-d85ed3a52585@0#134#1#take 001_pose_0#hash#e75f8178b961b379e83a7a94374e3b4a.geo.gcs",
    164: "snapshot/1d86c576-5fb6-11ef-ab3e-d85ed3a52585@0#164#1#take 001_pose_0#hash#9b4ead30e17dcaefeb91f4e42d28bbbf.geo.gcs",
}

# Правдоподобный диапазон координат одежды на ребёнке, сантиметры. Границы
# широкие нарочно: сузив их, легко подогнать поиск под ожидаемый ответ.
LO, HI = -150.0, 250.0


def load(name: str) -> bytes:
    return bw_source.blob(bw_source.connect("B-HDY-14"), name)


def longest_float_run(data: bytes, width: int) -> tuple[int, int] | None:
    """Самый длинный участок правдоподобных float подряд."""
    fmt = "<f" if width == 4 else "<d"
    best = (0, 0)
    start = None
    i = 0
    n = len(data) - width
    while i < n:
        (v,) = struct.unpack_from(fmt, data, i)
        ok = (v == v) and (LO < v < HI) and (abs(v) > 1e-4 or v == 0.0)
        if ok:
            if start is None:
                start = i
        else:
            if start is not None and i - start > best[1] - best[0]:
                best = (start, i)
            start = None
        i += width
    if start is not None and len(data) - start > best[1] - best[0]:
        best = (start, len(data))
    return best if best[1] - best[0] > width * 300 else None


def bounds_of(data: bytes, span: tuple[int, int], width: int):
    fmt = "f" if width == 4 else "d"
    start, end = span
    count = (end - start) // width
    count -= count % 3
    vals = struct.unpack_from("<" + fmt * count, data, start)
    lo = [min(vals[a::3]) for a in range(3)]
    hi = [max(vals[a::3]) for a in range(3)]
    return [hi[a] - lo[a] for a in range(3)], count // 3


if __name__ == "__main__":
    for size, name in SNAPSHOTS.items():
        data = load(name)
        print(f"=== размер {size}: {len(data) // 1024 // 1024} МБ")
        for width, label in ((4, "float32"), (8, "float64")):
            span = longest_float_run(data, width)
            if span is None:
                print(f"    {label}: длинного участка не нашлось")
                continue
            size3, points = bounds_of(data, span, width)
            print(
                f"    {label}: участок {span[1] - span[0]} байт, точек {points}, "
                f"габарит {size3[0]:.1f} x {size3[1]:.1f} x {size3[2]:.1f}"
            )

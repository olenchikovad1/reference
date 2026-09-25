#!/usr/bin/env python3
"""В каких единицах живёт сцена модели: габарит аватаров против их роста.

Аватары в исходнике названы по росту в сантиметрах (98, 134, 164) и лежат в
FBX — формате открытом. 23.09.2026 так доказано: единица сцены — САНТИМЕТР (у
emil габарит по высоте 137.67 при росте 134, 2.7 % на причёску; метр дал бы
1.37, миллиметр 1376). Записано в описании изделия, `scene_unit`.

Разбирается только узел Vertices двоичного FBX: массив double или float с
заголовком «число, сжатие, длина». Для габарита полный разбор дерева не нужен.

Где: хост, нужен zstd (см. `bw_source.py`):

    py scripts/garment/avatar_scale.py [КОД_ИЗДЕЛИЯ]
"""

import pathlib
import struct
import sys
import zlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import bw_source  # noqa: E402


def vertex_bounds(data: bytes) -> tuple[list[float], list[float], int] | None:
    lo, hi, seen, pos = [float("inf")] * 3, [float("-inf")] * 3, 0, 0
    while (pos := data.find(b"Vertices", pos)) >= 0:
        p = pos + len(b"Vertices")
        kind = data[p:p + 1]
        if kind not in (b"d", b"f"):
            pos = p
            continue
        count, encoding, length = struct.unpack("<III", data[p + 1:p + 13])
        raw = data[p + 13:p + 13 + length]
        if encoding == 1:
            try:
                raw = zlib.decompress(raw)
            except zlib.error:
                pos = p
                continue
        width = 8 if kind == b"d" else 4
        if count == 0 or count % 3 or len(raw) < count * width:
            pos = p
            continue
        vals = struct.unpack("<" + kind.decode() * count, raw[:count * width])
        for i in range(0, count, 3):
            for a in range(3):
                lo[a], hi[a] = min(lo[a], vals[i + a]), max(hi[a], vals[i + a])
        seen += count // 3
        pos = p + 13 + length
    return (lo, hi, seen) if seen else None


if __name__ == "__main__":
    con = bw_source.connect(sys.argv[1] if len(sys.argv) > 1 else "B-HDY-14")
    for (name,) in con.execute("select filename from file_tree "
                               "where filename like 'resource/avatars/%' and ext = '.fbx'"):
        b = vertex_bounds(bw_source.blob(con, name))
        if b is None:
            print(f"{name}: вершин не нашлось")
            continue
        lo, hi, n = b
        size = [hi[a] - lo[a] for a in range(3)]
        print(f"{name}\n    вершин {n}, габарит {size[0]:.2f} x {size[1]:.2f} x {size[2]:.2f}"
              " — сравнить наибольший с ростом в имени аватара")

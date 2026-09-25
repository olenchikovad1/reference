"""Чтение и запись PNG без библиотек: скрипты на хосте работают на голом Python.

Числа в описании изделия (силуэт, ориентиры, торс) сняты именно этим
чтением — с порогом альфы 128 для «непрозрачного». Подмена его на PIL в
контейнере дала бы те же пиксели, но держать два чтения ради одного и того же
незачем.

Поддержано то, что реально приходит: 8 и 16 бит на канал (16 сводятся к 8 —
старший байт), без чересстрочности, серый, RGB, серый с альфой, RGBA.
Палитровый PNG — отказ с причиной.
"""

import pathlib
import struct
import zlib

_CHANNELS = {0: 1, 2: 3, 4: 2, 6: 4}


def read(path: pathlib.Path) -> tuple[int, int, bytes]:
    """Ширина, высота и пиксели RGBA подряд; у картинки без альфы она 255."""
    d = path.read_bytes()
    if not d.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError(f"{path.name}: не PNG")
    i, idat, w, h, depth, colour, interlace = 8, bytearray(), 0, 0, 0, 0, 0
    while i < len(d):
        ln = struct.unpack(">I", d[i:i + 4])[0]
        typ, body = d[i + 4:i + 8], d[i + 8:i + 8 + ln]
        if typ == b"IHDR":
            w, h, depth, colour, _, _, interlace = struct.unpack(">IIBBBBB", body)
        elif typ == b"IDAT":
            idat += body
        i += 12 + ln
    if depth not in (8, 16) or interlace or colour not in _CHANNELS:
        raise ValueError(f"{path.name}: {depth} бит, тип цвета {colour}, чересстрочность {interlace} — не поддержано")
    # bpp — байт на пиксель: по нему фильтры берут соседа слева.
    n, bpp = _CHANNELS[colour], _CHANNELS[colour] * depth // 8
    raw, stride = zlib.decompress(bytes(idat)), w * bpp
    plane, prev, pos = bytearray(h * stride), bytearray(stride), 0
    for y in range(h):
        f = raw[pos]
        pos += 1
        line = bytearray(raw[pos:pos + stride])
        pos += stride
        # Фильтры строк PNG: разность с соседом слева, сверху, средним, Paeth.
        if f == 1:
            for x in range(bpp, stride):
                line[x] = (line[x] + line[x - bpp]) & 255
        elif f == 2:
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 255
        elif f == 3:
            for x in range(stride):
                a = line[x - bpp] if x >= bpp else 0
                line[x] = (line[x] + ((a + prev[x]) >> 1)) & 255
        elif f == 4:
            for x in range(stride):
                a = line[x - bpp] if x >= bpp else 0
                b, c = prev[x], (prev[x - bpp] if x >= bpp else 0)
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        plane[y * stride:(y + 1) * stride] = line
        prev = line
    if depth == 16:
        plane = plane[0::2]
    if n == 4:
        return w, h, bytes(plane)
    out = bytearray(w * h * 4)
    for k in range(w * h):
        px = plane[k * n:(k + 1) * n]
        rgb = px[:3] if n >= 3 else bytes((px[0],)) * 3
        out[k * 4:k * 4 + 4] = bytes(rgb) + bytes((px[-1] if n in (2, 4) else 255,))
    return w, h, bytes(out)


def write(path: pathlib.Path, w: int, h: int, rgba: bytes) -> None:
    raw = b"".join(b"\x00" + rgba[y * w * 4:(y + 1) * w * 4] for y in range(h))

    def chunk(t: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + t + data + struct.pack(">I", zlib.crc32(t + data) & 0xffffffff)

    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
                     + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))


def depth(path: pathlib.Path) -> int:
    """Бит на канал — из заголовка, не разбирая картинку."""
    return path.read_bytes()[24]


def opaque(rgba: bytes, w: int, x: int, y: int, threshold: int = 128) -> bool:
    return rgba[(y * w + x) * 4 + 3] > threshold

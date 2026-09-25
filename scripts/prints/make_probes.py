#!/usr/bin/env python3
"""Эталонные принты: каждый отвечает на один вопрос про печать.

Рисуются кодом, а не руками: размеры в них — часть ответа, и подогнать их на
глаз значит получить измерительный инструмент, который врёт.

Кладутся в том рядом с настоящими принтами: со стенда они доступны тем же
способом, и настоящие ничем от них не отличаются.

Где: хост, только стандартная библиотека — пишет в том, который в контейнере
подключён на чтение. Запуск из корня репозитория:

    py scripts/prints/make_probes.py

Вывод детерминирован: повторный запуск даёт те же байты.
"""
import pathlib
import struct
import zlib

OUT = pathlib.Path(__file__).resolve().parents[2] / "infra/stand/files/prints/probes"

# Сколько пикселей в сантиметре ВНУТРИ эталона. Число большое, чтобы линия
# толщиной в четверть миллиметра была хотя бы двумя пикселями: эталон, в
# котором тонкая линия пропала ещё до печати, ничего не измеряет.
PX_PER_CM = 80


def px(cm: float) -> int:
    return max(1, round(cm * PX_PER_CM))


class Canvas:
    """Простейший холст RGBA. Внешних библиотек нет по устройству проекта."""

    def __init__(self, w: int, h: int) -> None:
        self.w, self.h = w, h
        self.buf = bytearray(w * h * 4)

    def dot(self, x: int, y: int, rgba: tuple[int, int, int, int]) -> None:
        if 0 <= x < self.w and 0 <= y < self.h:
            i = (y * self.w + x) * 4
            self.buf[i:i + 4] = bytes(rgba)

    def rect(self, x: int, y: int, w: int, h: int, rgba=(17, 17, 17, 255)) -> None:
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.dot(xx, yy, rgba)

    def save(self, path: pathlib.Path) -> None:
        raw = b"".join(b"\x00" + bytes(self.buf[y * self.w * 4:(y + 1) * self.w * 4])
                       for y in range(self.h))

        def chunk(tag: bytes, data: bytes) -> bytes:
            body = tag + data
            return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xffffffff)

        path.write_bytes(
            b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", self.w, self.h, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 6))
            + chunk(b"IEND", b"")
        )


def grid_20cm() -> None:
    """Сетка 20x20 см с делениями по сантиметру: по ней глазом видно и
    искажение по складкам, и правдоподобна ли калибровка."""
    side = px(20)
    c = Canvas(side, side)
    # Толщины настоящие, в миллиметрах: деление 0.5 мм, пятёрка 1 мм. Линия
    # в один пиксель исходника — это 0.125 мм, тоньше всего печатаемого, и на
    # изделии она пропадает. Эталон, который исчезает, ничего не измеряет.
    for i in range(21):
        p = min(side - 1, px(i))
        thick = px(0.1) if i % 5 == 0 else px(0.05)
        c.rect(p, 0, thick, side)
        c.rect(0, p, side, thick)
    # Рамка потолще: край сетки должен быть виден на изделии без сомнений.
    c.rect(0, 0, side, 5, (192, 57, 43, 255))
    c.rect(0, side - 5, side, 5, (192, 57, 43, 255))
    c.rect(0, 0, 5, side, (192, 57, 43, 255))
    c.rect(side - 5, 0, 5, side, (192, 57, 43, 255))
    c.save(OUT / "setka-20cm.png")


def lines() -> None:
    """Линии 2 / 1 / 0.5 / 0.25 мм: видно, с какой толщины линия теряется."""
    w, h = px(16), px(10)
    c = Canvas(w, h)
    for n, mm in enumerate((2.0, 1.0, 0.5, 0.25)):
        y = px(1.5) + n * px(2)
        c.rect(px(1), y, px(14), px(mm / 10))
    c.save(OUT / "linii-2-1-05-025mm.png")


def letters() -> None:
    """Буквы 10 / 6 / 4 / 3 мм — тот же вопрос для кегля.

    Буквы рисуются прямоугольниками, а не шрифтом: важна высота штриха и
    просвет между ними, а не начертание. Настоящий шрифт тут только помешал бы
    считать, что именно потерялось.
    """
    w, h = px(16), px(11)
    c = Canvas(w, h)
    y = px(1)
    for mm in (10.0, 6.0, 4.0, 3.0):
        hgt = px(mm / 10)
        stroke = max(1, round(hgt / 6))
        x = px(1)
        for _ in range(8):
            c.rect(x, y, stroke, hgt)                      # левая стойка
            c.rect(x + hgt // 2, y, stroke, hgt)           # правая стойка
            c.rect(x, y + hgt // 2, hgt // 2, stroke)      # перекладина
            x += hgt
        y += hgt + px(0.4)
    c.save(OUT / "bukvy-10-6-4-3mm.png")


def hard_edge() -> None:
    """Плашка с резкой границей: как ведёт себя смещение на краю."""
    w, h = px(12), px(12)
    c = Canvas(w, h)
    c.rect(0, 0, w, h // 2, (17, 17, 17, 255))
    c.rect(0, h // 2, w, h - h // 2, (240, 240, 240, 255))
    c.save(OUT / "plashka-rezkiy-kray.png")


def opaque_background() -> None:
    """PNG с непрозрачным фоном: тот самый прямоугольник."""
    w, h = px(12), px(9)
    c = Canvas(w, h)
    c.rect(0, 0, w, h, (221, 221, 221, 255))
    c.rect(px(2), px(2), px(8), px(5), (44, 62, 80, 255))
    c.save(OUT / "fon-ne-vyrezan.png")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for fn in (grid_20cm, lines, letters, hard_edge, opaque_background):
        fn()

    for f in sorted(OUT.glob("*.png")):
        print(f"  {f.name:32} {f.stat().st_size // 1024} КБ")

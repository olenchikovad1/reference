"""Лист миниатюр набора принтов — посмотреть глазами всё разом.

Ожидаемые теги пишутся по картинке, а не по имени файла (урок is3-summer:
имя врало дважды). Лист кладёт принты на шахматку, так что прозрачность видна
сразу: вырезанный силуэт отличается от сцены с рамкой.

Где: контейнер api (PIL). Том там только на чтение — лист уходит в stdout:

    docker compose -f infra/compose.yaml exec -T api python -m scripts.prints.contact_sheet [ШАБЛОН] > лист.png
"""

import io
import pathlib
import sys

from PIL import Image, ImageDraw

PRINTS = pathlib.Path("/srv/reference/files/prints")
CELL, LABEL, COLS = 240, 18, 6


def checker(size: int) -> Image.Image:
    bg = Image.new("RGB", (size, size), (255, 255, 255))
    d = ImageDraw.Draw(bg)
    for y in range(0, size, 16):
        for x in range((y // 16 % 2) * 16, size, 32):
            d.rectangle([x, y, x + 15, y + 15], fill=(215, 215, 215))
    return bg


def main() -> None:
    pattern = sys.argv[1] if len(sys.argv) > 1 else "*.png"
    files = sorted(PRINTS.glob(pattern))
    rows = (len(files) + COLS - 1) // COLS
    sheet = Image.new("RGB", (COLS * CELL, rows * (CELL + LABEL)), (60, 60, 60))
    draw = ImageDraw.Draw(sheet)
    for k, f in enumerate(files):
        x, y = k % COLS * CELL, k // COLS * (CELL + LABEL)
        cell = checker(CELL)
        with Image.open(f) as im:
            im = im.convert("RGBA")
            im.thumbnail((CELL - 8, CELL - 8))
            cell.paste(im, ((CELL - im.width) // 2, (CELL - im.height) // 2), im)
        sheet.paste(cell, (x, y))
        draw.text((x + 4, y + CELL + 3), f.name[:38], fill=(255, 255, 255))
    out = io.BytesIO()
    sheet.save(out, format="PNG")
    sys.stdout.buffer.write(out.getvalue())


if __name__ == "__main__":
    main()

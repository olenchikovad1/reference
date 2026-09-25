"""Варианты принта: та же картинка, изменённая так, что хеш её уже не узнаёт.

Нужны, чтобы проверять узнавание не на честных копиях, а на том, что реально
приходит: картинку уменьшили, пересохранили из чата, обрезали, осветлили.
Параметры — ровно те, на которых сделан замер US-0431 (23.09.2026, записан в
`infra/stand/fixtures/prints.yaml`, раздел `measured.same_picture_samples`):
с другими параметрами записанные там числа не воспроизвести.

Где: контейнер `api` — нужны PIL и numpy. Том принтов там только на чтение,
поэтому результат уходит в stdout, а на диск его кладёт хост:

    docker compose -f infra/compose.yaml exec -T api \\
        python -m scripts.prints.variants from_chat is3-summer-print.png \\
        > infra/stand/files/prints/is3-summer-iz-chata.png

Замеры берут варианты в памяти через `make(name, data)`, не через файлы.
"""

import io
import pathlib
import sys
from collections.abc import Callable

import numpy as np
from PIL import Image, ImageEnhance

PRINTS = pathlib.Path("/srv/reference/files/prints")


def _png(fn: Callable[[Image.Image], Image.Image]) -> Callable[[bytes], bytes]:
    def run(data: bytes) -> bytes:
        with Image.open(io.BytesIO(data)) as im:
            out = io.BytesIO()
            fn(im.convert("RGBA")).save(out, format="PNG")
            return out.getvalue()
    return run


def _jpeg70(data: bytes) -> bytes:
    # JPEG без альфы: так картинка выглядит после мессенджера, который сжал
    # её как фото. Прозрачность при этом пропадает — это часть варианта.
    with Image.open(io.BytesIO(data)) as im:
        out = io.BytesIO()
        im.convert("RGB").save(out, format="JPEG", quality=70)
        return out.getvalue()


def _from_chat(im: Image.Image) -> Image.Image:
    # «Прислали из чата»: ширина 700 и сдвиг оттенка, будто картинку прогнали
    # через чужой редактор. Файл `is3-summer-iz-chata.png` на стенде — этот
    # вариант от `is3-summer-print.png`.
    w = 700
    small = im.resize((w, round(im.height / im.width * w)), Image.Resampling.LANCZOS)
    a = np.asarray(small).astype("int16")
    a[..., 0] = np.clip(a[..., 0] * 1.12, 0, 255)
    a[..., 2] = np.clip(a[..., 2] * 0.88, 0, 255)
    return Image.fromarray(a.astype("uint8"), "RGBA")


#: Имя варианта → преобразование байтов. Подписи — как в `prints.yaml`.
VARIANTS: dict[str, tuple[str, Callable[[bytes], bytes]]] = {
    "jpeg70": ("пересохранена в JPEG 70", _jpeg70),
    "halved": ("уменьшена вдвое", _png(lambda im: im.resize((im.width // 2, im.height // 2)))),
    # В prints.yaml записано «перекрашена теплее», но замер делал именно это —
    # насыщенность ×1.8, оттенок не сдвигался.
    "saturated": ("перекрашена теплее (насыщенность ×1.8)", _png(lambda im: ImageEnhance.Color(im).enhance(1.8))),
    "brighter": ("осветлена на треть", _png(lambda im: ImageEnhance.Brightness(im).enhance(1.3))),
    "cropped": ("обрезана на 10%", _png(lambda im: im.crop((
        int(im.width * .05), int(im.height * .05), int(im.width * .95), int(im.height * .95))))),
    "from_chat": ("из чата: ширина 700, оттенок сдвинут", _png(_from_chat)),
}


def make(name: str, data: bytes) -> bytes:
    return VARIANTS[name][1](data)


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in VARIANTS:
        sys.exit("вариант и файл принта: " + " | ".join(VARIANTS) + " <имя в наборе>")
    src = PRINTS / sys.argv[2]
    if not src.is_file():
        sys.exit(f"нет принта {src} — том пуст? см. scripts/stand/verify_volume.py")
    sys.stdout.buffer.write(make(sys.argv[1], src.read_bytes()))

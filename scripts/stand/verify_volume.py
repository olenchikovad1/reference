#!/usr/bin/env python3
"""Сверка тома стенда с тем, что о нём записано: что на месте, что подменено,
чего нет — и что с каждым делать.

Зачем: 25.09.2026 стенд переехал на другую машину пустым, и об этом узнали по
упавшим проверкам, а не отсюда. Хуже пустоты — подмена: кадр, пересланный
фото через мессенджер, теряет прозрачность, и силуэт, зоны и калибровка,
снятые по ней, молча разъезжаются с картинкой. Хеш это ловит, глаз — нет.

Что сверяется:
- исходник и кадры изделий — по sha256 из `infra/stand/fixtures/<код>.yaml`;
- принты набора — по sha256 из `prints.yaml`, где он записан, иначе по наличию;
- эталоны — по наличию (их делает `scripts/prints/make_probes.py`);
- модели — по размеру, как их проверяет `scripts/stand/fetch_models.py`.

Где: хост, нужен PyYAML. Запуск из корня репозитория, до подъёма стенда:

    py scripts/stand/verify_volume.py

Код возврата 1, если нужного стенду файла нет или он не тот. Исходник модели
стенду не нужен (код читает только путь) — его отсутствие не ошибка.
"""

import hashlib
import pathlib
import struct
import sys

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[2]
FILES = ROOT / "infra/stand/files"
FIXTURES = ROOT / "infra/stand/fixtures"

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fetch_models import MODELS  # noqa: E402 — список моделей один, здесь не повторяется


def sha256(path: pathlib.Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


def png_facts(path: pathlib.Path) -> str:
    """Что видно из заголовка: формат, размер, есть ли альфа. Подсказка к
    несовпадению — «тот же кадр, но без прозрачности» лечится иначе, чем
    «другой рендер»."""
    head = path.read_bytes()[:26]
    if not head.startswith(b"\x89PNG\r\n\x1a\n"):
        kind = "JPEG" if head[:3] == b"\xff\xd8\xff" else "не PNG"
        return f"{kind} — прозрачности нет"
    w, h, _, colour = struct.unpack(">IIBB", head[16:26])
    alpha = "с альфой" if colour in (4, 6) else "БЕЗ альфы"
    return f"PNG {w}x{h}, {alpha}"


problems = 0


def report(status: str, rel: str, note: str = "") -> None:
    global problems
    if status in ("НЕТ", "НЕ ТОТ"):
        problems += 1
    print(f"  {status:8} {rel}" + (f" — {note}" if note else ""))


def check_hashed(rel: str, want: str, required: bool, hint: str) -> None:
    path = FILES / rel
    if not path.is_file():
        if required:
            report("НЕТ", rel, hint)
        else:
            print(f"  {'нет':8} {rel} — стенду не нужен")
        return
    got = sha256(path)
    if got == want:
        report("совпал", rel)
    else:
        extra = png_facts(path) if path.suffix.lower() == ".png" else f"{path.stat().st_size} байт"
        report("НЕ ТОТ", rel, f"sha256 {got[:12]}… вместо {want[:12]}…; {extra}")


def products() -> None:
    for fx in sorted(FIXTURES.glob("*.yaml")):
        data = yaml.safe_load(fx.read_text(encoding="utf-8")) or {}
        if "states" not in data:
            continue
        print(f"изделие {data.get('code', fx.stem)}:")
        src = data.get("source") or {}
        if src.get("path") and src.get("sha256"):
            check_hashed(src["path"], src["sha256"], required=False, hint="")
        for st in data["states"]:
            frame = st.get("frame") or {}
            if frame.get("path") and frame.get("sha256"):
                check_hashed(frame["path"], frame["sha256"], required=True,
                             hint="кадр из VStitcher файлом, не фото; с офиса — "
                                  "C:\\Projects\\reference\\infra\\stand\\files")


def prints() -> None:
    data = yaml.safe_load((FIXTURES / "prints.yaml").read_text(encoding="utf-8")) or {}
    print("принты набора:")
    for f in data.get("files", []):
        rel = f"prints/{f['name']}"
        if f.get("sha256"):
            check_hashed(rel, f["sha256"], required=True, hint="файл от владельца, файлом, не фото")
        elif (FILES / rel).is_file():
            report("есть", rel, "хеш не записан — сверить не с чем")
        else:
            report("НЕТ", rel, "файл от владельца, файлом, не фото")
    print("эталоны:")
    for p in data.get("probes", []):
        rel = f"prints/probes/{p['name']}"
        if (FILES / rel).is_file():
            report("есть", rel)
        else:
            report("НЕТ", rel, "py scripts/prints/make_probes.py")


def models() -> None:
    print("модели:")
    for m in MODELS:
        rel = m["path"].removeprefix("files/")
        path = FILES / rel
        if not path.is_file():
            report("НЕТ", rel, "py scripts/stand/fetch_models.py")
        elif path.stat().st_size != m["size"]:
            report("НЕ ТОТ", rel, f"{path.stat().st_size} байт вместо {m['size']} — перекачать")
        else:
            report("совпал", rel)


if __name__ == "__main__":
    products()
    prints()
    models()
    print("\nвсё на месте" if not problems else f"\nпроблем: {problems}")
    sys.exit(1 if problems else 0)

#!/usr/bin/env python3
"""Выложить кадры изделий и принты в сменный том garment-assets.

Зачем: на prod холст и библиотека читают FILES_VOLUME_PATH. Стендовый каталог
`infra/stand/files` смешивает кадры с нейросетями и голосом; боевой том —
только то, без чего нельзя рисовать (кадры состояний и принты). Его можно
заменить другим каталогом (позже — с Drive), не трогая код: сервис знает только
путь из настройки.

Источник на старте — стенд (решение 0012). Исходник `.bw` не копируется
(решение 0002, И-10). Нейросети в этот том не входят — их по-прежнему кладёт
`fetch_models.py` в тот же FILES_VOLUME_PATH на машине, где нужна разметка.

Где: хост, стандартная библиотека (+ PyYAML для сверки описаний). Из корня:

    py scripts/stand/seed_garment_assets.py
    py scripts/stand/seed_garment_assets.py --dest D:/data/garment-assets

Потом на стенде или prod: FILES_HOST_PATH указывает на этот каталог.
"""

from __future__ import annotations

import argparse
import pathlib
import shutil
import sys

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[2]
DEFAULT_SOURCE = ROOT / "infra" / "stand" / "files"
DEFAULT_DEST = ROOT / "infra" / "garment-assets"
FIXTURES = ROOT / "infra" / "stand" / "fixtures"

# Подкаталоги тома, которые нужны холсту и библиотеке. source/ изделий сюда
# не входит — его в git нет и на prod он не обязателен.
TREES = ("products", "prints")


def copy_tree(src: pathlib.Path, dest: pathlib.Path) -> int:
    """Скопировать дерево, пропуская products/*/source/. Число файлов."""
    if not src.is_dir():
        return 0
    count = 0
    for path in src.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(src)
        # Исходник VStitcher — сотни мегабайт, сервису на бою не нужен.
        if rel.parts[:1] == ("products",) and "source" in rel.parts:
            continue
        target = dest / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
        count += 1
    return count


def required_frames() -> list[str]:
    """Пути кадров из описаний изделий — то, без чего холст не откроется."""
    paths: list[str] = []
    for fx in sorted(FIXTURES.glob("*.yaml")):
        data = yaml.safe_load(fx.read_text(encoding="utf-8")) or {}
        if "states" not in data:
            continue
        for st in data["states"]:
            frame = (st.get("frame") or {}).get("path")
            if frame:
                paths.append(frame)
    return paths


def verify(dest: pathlib.Path) -> list[str]:
    missing = [p for p in required_frames() if not (dest / p).is_file()]
    prints = dest / "prints"
    if not prints.is_dir() or not any(prints.glob("*.png")):
        missing.append("prints/*.png")
    return missing


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=pathlib.Path,
        default=DEFAULT_SOURCE,
        help=f"откуда брать (по умолчанию {DEFAULT_SOURCE})",
    )
    parser.add_argument(
        "--dest",
        type=pathlib.Path,
        default=DEFAULT_DEST,
        help=f"куда класть (по умолчанию {DEFAULT_DEST})",
    )
    args = parser.parse_args(argv)
    source: pathlib.Path = args.source.resolve()
    dest: pathlib.Path = args.dest.resolve()

    if not source.is_dir():
        print(f"источника нет: {source}", file=sys.stderr)
        return 1

    dest.mkdir(parents=True, exist_ok=True)
    total = 0
    for name in TREES:
        n = copy_tree(source / name, dest / name)
        print(f"  {name}: {n} файлов -> {dest / name}")
        total += n

    missing = verify(dest)
    if missing:
        print("в томе не хватает:", file=sys.stderr)
        for p in missing:
            print(f"  {p}", file=sys.stderr)
        return 1

    print(f"готово: {total} файлов в {dest}")
    print("монтирование: FILES_HOST_PATH на этот каталог (см. infra/.env.example)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

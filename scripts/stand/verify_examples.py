"""Показ перенесённых примеров через работающий API, без изменения работы.

Контейнер API: python -m scripts.stand.verify_examples /transfer/examples.tar.
Проверяются состав витрины, версии и рабочие документы трёх карточек,
миниатюры сторон и превью их принтов. --require-plm проверяет выпуск палитры.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import tarfile
import time
import urllib.request


BASE = "http://127.0.0.1:8000/reference/api/"


def fetch(path: str):
    started = time.monotonic()
    print(f"Проверяю {path}", flush=True)
    with urllib.request.urlopen(BASE + path, timeout=15) as response:
        content = response.read()
        if response.headers.get("content-type", "").startswith("application/json"):
            return json.loads(content)
        if not content:
            raise ValueError(f"Пустое изображение: {path}")
        print(f"Изображение: {len(content)} байт, {time.monotonic() - started:.1f} с", flush=True)
        return len(content)


def verify(path: Path, require_plm: bool) -> dict:
    with tarfile.open(path) as archive:
        member = archive.extractfile("manifest.json")
        if member is None:
            raise ValueError("Нет описи")
        manifest = json.load(member)
    expected = {row["id"]: row for row in manifest["tables"]["reference_cards"]
                if row["deleted_at"] is None and row["status"] != "rejected"}
    cards = fetch("references")
    found = {card["id"] for card in cards}
    if not set(expected) <= found:
        raise ValueError(f"Не видны карточки: {sorted(set(expected) - found)}")
    latest = {}
    for version in manifest["tables"]["reference_versions"]:
        key = version["reference_id"]
        if key not in latest or version["number"] > latest[key]["number"]:
            latest[key] = version
    samples = sorted(expected)[-3:]
    images = set()
    for card_id in samples:
        opened = fetch(f"references/{card_id}")
        version = latest[card_id]
        if opened["number"] != version["number"] or opened["work"] != version["work"]:
            raise ValueError(f"Не совпала сохранённая работа: {card_id}")
        expected_versions = sum(row["reference_id"] == card_id for row in manifest["tables"]["reference_versions"])
        if len(opened["versions"]) != expected_versions:
            raise ValueError(f"Не совпала история версий: {card_id}")
        images.update(f"assets/{digest}/thumb" for digest in (version.get("views") or {}).values())
        images.update(f"assets/{digest}/preview" for digest in version.get("image_digests", []))
    with ThreadPoolExecutor(max_workers=2) as workers:
        image_sizes = list(workers.map(fetch, sorted(images)))
    palette = fetch("colours")
    if require_plm and palette["source"] != "PLM":
        raise ValueError(f"Палитра ещё не переключена: {palette['source']}")
    library = fetch("assets/library")
    texts = fetch("library/texts")
    available = {entry["key"] for entry in manifest["objects"]}
    missing_views = {digest for version in latest.values() for digest in (version.get("views") or {}).values()
                     if f"assets/{digest}/thumb" not in available}
    return {"visible_examples": len(expected), "visible_total": len(cards), "opened": samples,
            "images_checked": len(image_sizes), "library_items": len(library), "texts": len(texts),
            "source_missing_thumbnails": len(missing_views),
            "palette_source": palette["source"], "palette_colors": len(palette["colors"])}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--require-plm", action="store_true")
    args = parser.parse_args()
    print(json.dumps(verify(args.archive, args.require_plm), ensure_ascii=False, indent=2))

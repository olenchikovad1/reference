#!/usr/bin/env python3
"""Добыча моделей и словарей, без которых стенд собирается, но не работает.

Что качать, откуда и что должно получиться — опись
`infra/stand/fixtures/models.json` (план 087, US-0624). Модели в репозиторий
не едут: каждая замена осталась бы в истории навсегда. Но модель, о которой
нигде не сказано, превращает стенд в «работает на моей машине»: на чистом
клоне узнавание свалится в FileNotFoundError из недр onnxruntime.

Запускается на голой машине, до docker compose up, одной стандартной
библиотекой:

    py scripts/stand/fetch_models.py

Файл на месте и совпал по sha256 — не качается. Оборванная закачка
докачивается с места обрыва: огрызок лежит рядом с суффиксом .part и за
модель не сойдёт. Не совпала сумма после закачки — файл удаляется, выход с
причиной: подменённая модель хуже отсутствующей, она размечает молча иначе.
"""

import hashlib
import json
import pathlib
import sys
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
INVENTORY = ROOT / "infra/stand/fixtures/models.json"
#: Пути в описи — относительно тома стенда, как их видит сервис.
FILES = ROOT / "infra/stand/files"
HEADERS = {"User-Agent": "reference-stand/1.0 (fetch_models)"}


def inventory() -> list[dict]:
    """Файлы описи плоским списком, у каждого — готовая ссылка."""
    out = []
    for model in json.loads(INVENTORY.read_text(encoding="utf-8"))["models"]:
        for f in model["files"]:
            url = model.get("url") or (
                f"https://huggingface.co/{model['repo']}/resolve/{model['revision']}/{f['source']}"
            )
            out.append({**f, "url": url, "model": model["id"]})
    return out


def sha256(path: pathlib.Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


def fetch(item: dict) -> None:
    dst = FILES / item["path"]
    if dst.is_file() and dst.stat().st_size == item["size"] and sha256(dst) == item["sha256"]:
        print(f"уже на месте: {item['path']}")
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    part = dst.with_suffix(dst.suffix + ".part")
    have = part.stat().st_size if part.is_file() else 0
    if have > item["size"]:
        part.unlink()
        have = 0
    if have < item["size"]:
        verb = f"докачиваю с {have / 1e6:.0f} МБ" if have else "качаю"
        print(f"{verb} {item['path']} ({item['size'] / 1e6:.0f} МБ)...")
        req = urllib.request.Request(item["url"], headers={**HEADERS, **({"Range": f"bytes={have}-"} if have else {})})
        with urllib.request.urlopen(req, timeout=60) as r:
            # Сервер без поддержки Range отдаёт файл целиком (200, а не 206):
            # дописывать его к огрызку — получить склейку из двух начал.
            mode = "ab" if have and r.status == 206 else "wb"
            with part.open(mode) as f:
                while chunk := r.read(1 << 20):
                    f.write(chunk)
    got_size, got_sum = part.stat().st_size, sha256(part)
    if got_size != item["size"] or got_sum != item["sha256"]:
        part.unlink()
        sys.exit(f"{item['path']}: пришло не то — {got_size} байт, sha256 {got_sum[:12]}…,"
                 f" ждали {item['size']} и {item['sha256'][:12]}…. Ссылка: {item['url']}")
    part.replace(dst)
    print(f"готово, sha256 совпал: {item['path']}")


def main() -> None:
    for item in inventory():
        try:
            fetch(item)
        except urllib.error.URLError as e:
            sys.exit(f"{item['path']}: не скачался ({e}). Недокачанное лежит рядом с .part —"
                     f" повторный запуск продолжит с места обрыва")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Принты для набора настройки — с Wikimedia Commons, с правом и автором.

Картинку без понятного права в набор не берём (план 076, US-0520): набор
лежит в git и уходит на каждую машину. У Commons право записано у каждого
файла — лицензия, автор, ссылка, — и скрипт их печатает, чтобы они легли в
описание набора рядом с файлом.

Качается не оригинал, а версия заданной ширины (по умолчанию 1500 px): оригиналы
бывают по 20 МБ, а принту для стенда столько не нужно. Векторную картинку
(SVG) Commons сам отрисовывает в PNG этой ширины с прозрачным фоном — так
получаются вырезанные принты, каких в наборе владельца нет ни одного.

Где: хост, стандартная библиотека. Только чтение API и скачивание PNG —
ничего не исполняется.

    py scripts/prints/commons.py search "teddy bear transparent"   # кандидаты PNG
    py scripts/prints/commons.py search-svg "teddy bear clipart"   # векторные
    py scripts/prints/commons.py fetch "File:Имя.png" имя-в-наборе.png [ширина]
"""

import json
import pathlib
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import rgba_png  # noqa: E402

API = "https://commons.wikimedia.org/w/api.php"
PRINTS = pathlib.Path(__file__).resolve().parents[2] / "infra/stand/files/prints"
#: Commons просит представляться: безымянные запросы режут первыми.
HEADERS = {"User-Agent": "reference-stand/1.0 (prints tuning set; internal)"}
#: Право, с которым картинку можно положить в репозиторий и показывать.
ALLOWED = re.compile(r"^(Public domain|PD|CC0|CC BY(-SA)? [0-9.]+|CC BY(-SA)?)", re.I)


def get(url: str, timeout: int = 30) -> bytes:
    """GET с уважением к лимиту: на 429 ждём, сколько просит сервер, три раза."""
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == 2:
                raise
            wait = int(e.headers.get("Retry-After") or 10)
            print(f"# Commons просит подождать {wait} с", file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError("недостижимо")


def api(**params: str) -> dict:
    q = urllib.parse.urlencode({"format": "json", "formatversion": "2", **params})
    return json.loads(get(f"{API}?{q}"))


IIPROP = "url|size|mime|extmetadata"


def describe(page: dict) -> dict:
    ii = page["imageinfo"][0]
    meta = ii.get("extmetadata", {})

    def m(key: str) -> str:
        return re.sub(r"<[^>]+>", "", meta.get(key, {}).get("value", "")).strip()

    return {"title": page["title"], "mime": ii["mime"], "size": [ii["width"], ii["height"]],
            "thumb": ii.get("thumburl") or ii["url"], "page": ii["descriptionurl"],
            "license": m("LicenseShortName"), "artist": m("Artist")[:120]}


def info(title: str, width: int) -> dict:
    return describe(api(action="query", titles=title, prop="imageinfo", iiprop=IIPROP,
                        iiurlwidth=str(width))["query"]["pages"][0])


def search(query: str, mime: str = "image/png") -> None:
    # Одним запросом: поиск генератором и сведения о файлах сразу — по запросу
    # на файл Commons отвечает 429.
    pages = api(action="query", generator="search", gsrnamespace="6", gsrlimit="15",
                gsrsearch=f"{query} filemime:{mime}", prop="imageinfo", iiprop=IIPROP,
                iiurlwidth="1500").get("query", {}).get("pages", [])
    for page in pages:
        i = describe(page)
        ok = "ok " if ALLOWED.match(i["license"]) else "НЕТ"
        print(f"{ok} {i['size'][0]:5}x{i['size'][1]:<5} {i['license']:18} {i['title']}")


def fetch(title: str, name: str, width: int) -> None:
    i = info(title, width)
    if i["mime"] not in ("image/png", "image/svg+xml"):
        sys.exit(f"{title}: {i['mime']}, а нужен PNG или SVG")
    if not ALLOWED.match(i["license"]):
        sys.exit(f"{title}: право «{i['license']}» — в набор не берём")
    dst = PRINTS / name
    data = get(i["thumb"], timeout=60)
    if not data.startswith(b"\x89PNG"):
        sys.exit(f"{title}: пришёл не PNG")
    dst.write_bytes(data)
    note = None
    if rgba_png.depth(dst) == 16:
        # Фото с 16 битами на канал весит втрое больше, а стенд и замеры
        # работают с 8. Сводим здесь, а не руками, — и пишем об этом.
        rgba_png.write(dst, *rgba_png.read(dst))
        note = "сведён к 8 битам на канал (исходник 16)"
    print(json.dumps({"name": name, "source": i["page"], "license": i["license"], "author": i["artist"],
                      "bytes": dst.stat().st_size, "note": note}, ensure_ascii=False))


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "search":
        search(" ".join(sys.argv[2:]))
    elif len(sys.argv) >= 3 and sys.argv[1] == "search-svg":
        search(" ".join(sys.argv[2:]), "image/svg+xml")
    elif len(sys.argv) >= 4 and sys.argv[1] == "fetch":
        fetch(sys.argv[2], sys.argv[3], int(sys.argv[4]) if len(sys.argv) > 4 else 1500)
    else:
        sys.exit(__doc__)

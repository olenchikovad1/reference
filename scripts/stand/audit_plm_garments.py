"""Проверить источник кадров/размеров PLM, не создавая изделий и не копируя каталог.

В контейнере API: python -m scripts.stand.audit_plm_garments.
До восьми релизов, два паспорта и два preview. Ключи и документы не выводятся.

На хосте без зависимостей: --access-file <локальный файл доступа>.
Два паспорта и дропы, три GET с таймаутом 15 секунд, без повторов/redirect.
Личный ключ остаётся на хосте; содержимое документов не выводится.
"""

import argparse
import asyncio
from io import BytesIO
import json
from pathlib import Path
import re
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


async def audit(limit: int) -> dict[str, Any]:
    from PIL import Image
    from reference_api.config import settings
    from reference_api.db import session_factory
    from reference_api.services import plm

    cfg = settings()
    if not cfg.plm_base_url or not cfg.plm_machine_key:
        raise RuntimeError("PLM application channel is not configured")
    base, key = cfg.plm_base_url, cfg.plm_machine_key
    colorways = await plm.list_colorways(base, key)
    async with session_factory() as db:
        enriched = await plm.enrich_colorways(db, colorways)
    working_samples = []
    for item in [item for item in enriched if item["can_work"]][:2]:
        passport = await plm.colorway_card(base, key, item["id"])
        working_samples.append({**item,
                                "images": passport.get("images") or []})
    releases = await plm.list_releases(base, key, limit=limit)
    white: list[dict[str, Any]] = []
    gate = asyncio.Semaphore(3)

    async def inspect_release(release: dict[str, Any]) -> list[dict[str, Any]]:
        async with gate:
            card = await plm.release_card(base, key, release["id"])
        found = []
        for style in card.get("styles") or []:
            for cw in style.get("colorways") or []:
                color = str(cw.get("base_color") or cw.get("color") or "").upper()
                if "WHITE" not in color and "БЕЛ" not in color:
                    continue
                found.append({"release_id": release["id"], "style": style.get("code"),
                              "id": cw["id"], "article": cw.get("article"), "color": color,
                              "size_range": style.get("size_range"),
                              "images": [{"key": image.get("key"), "side": image.get("side"),
                                          "name": image.get("name")} for image in cw.get("images") or []]})
        return found

    for group in await asyncio.gather(*(inspect_release(release) for release in releases)):
        white.extend(group)
    samples = []
    for item in [item for item in white if item["images"]][:2]:
        passport = await plm.colorway_card(base, key, item["id"])
        # Главная картинка бывает заглушкой 30×40, даже когда рендеры есть.
        candidates = [image for image in item["images"] if image["key"]]
        image = next((image for image in candidates if image["side"] == "front"), None)
        if image is None:
            image = next((image for image in candidates if re.search(r"перед|front", image["name"] or "", re.I)), None)
        image = image or next(iter(candidates), None)
        picture = None
        if image:
            data, media = await plm.fetch_image(base, key, image["key"], "preview")
            with Image.open(BytesIO(data)) as opened:
                picture = {"key": image["key"], "preset": "preview", "media": media, "bytes": len(data),
                           "width": opened.width, "height": opened.height,
                           "at_least_800": min(opened.size) >= 800, "mode": opened.mode}
        documents = {}
        for name in ("size_charts", "patterns", "technology", "bom"):
            value = passport.get(name)
            documents[name] = {"type": type(value).__name__,
                               "count": len(value) if isinstance(value, (list, dict)) else None,
                               "fields": sorted(value) if isinstance(value, dict) else
                               sorted(value[0]) if isinstance(value, list) and value and isinstance(value[0], dict) else []}
        samples.append({**item, "preview": picture, "passport_fields": sorted(passport), "documents": documents,
                        "passport": {name: passport.get(name) for name in
                                     ("article", "size_range", "sizes", "readiness", "brand", "category")}})
    return {"colorways": len(enriched), "can_work": sum(item["can_work"] for item in enriched),
            "working_sample": working_samples,
            "sample_colorways": [item for item in enriched if item["id"] in {sample["id"] for sample in samples}],
            "with_image": sum(bool(item["image"]) for item in enriched), "releases_checked": len(releases),
            "release_limit": limit, "white_variants": len(white),
            "white_with_size_range": sum(bool(item["size_range"]) for item in white), "samples": samples}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args: Any, **kwargs: Any) -> None:
        return None


def audit_host(access_file: Path, colorway_ids: list[str]) -> dict[str, Any]:
    """Три GET с машины владельца; ключ не передаётся контейнеру/серверу."""
    access = json.loads(access_file.read_text(encoding="utf-8-sig"))
    origin = urlsplit(access["url"])
    if origin.scheme != "https" or origin.netloc != "platform.toribrands.ru":
        raise ValueError("Unsupported source origin")
    if len(colorway_ids) > 2 or any(not re.fullmatch(r"[A-Za-z0-9-]{1,64}", value) for value in colorway_ids):
        raise ValueError("At most two colorway identifiers are supported")
    opener = build_opener(NoRedirect())

    def read(resource: str) -> dict[str, Any]:
        request = Request("https://platform.toribrands.ru/reference/api/plm/" + resource,
                          headers=access["headers"])
        with opener.open(request, timeout=15) as response:
            content = response.read(8_000_001)
        if len(content) > 8_000_000:
            raise ValueError("Source response exceeds audit limit")
        result = json.loads(content)
        if not isinstance(result, dict):
            raise ValueError("Source response is not an object")
        return result

    samples = []
    for identifier in colorway_ids:
        passport = read("colorways/" + identifier)
        samples.append({"id": identifier, "article": passport.get("article"),
                        "size_range": passport.get("size_range"),
                        "fields": sorted(passport),
                        "counts": {name: len(passport[name]) if isinstance(passport.get(name), list) else None
                                   for name in ("images", "releases", "sizes", "size_charts", "patterns", "technology", "bom")},
                        "readiness": passport.get("readiness")})
    drops = read("drops?active_only=false").get("items")
    if not isinstance(drops, list) or any(not isinstance(row, dict) for row in drops):
        raise ValueError("Source drops response is not an items array")
    return {"scope": "two production passports and drops; read-only from owner host",
            "samples": samples, "drops": len(drops),
            "drop_fields": sorted({field for row in drops for field in row}),
            "with_sales_window": sum(row.get("intake_week") is not None and row.get("exit_week") is not None for row in drops)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-limit", type=int, default=8, choices=range(1, 9))
    parser.add_argument("--access-file", type=Path, help="Host-only read-only mode; the key stays on this machine")
    parser.add_argument("--colorway", action="append", default=[])
    args = parser.parse_args()
    if args.access_file:
        try:
            report = audit_host(args.access_file, args.colorway or ["01M3MH7YCT9QSJP0MCWH0CPJB0", "01M3MH7YCNTYGXVK0DFNZ0KASB"])
        except (OSError, ValueError, KeyError, URLError, HTTPError) as error:
            print(json.dumps({"error": type(error).__name__, "http": getattr(error, "code", None)}))
            raise SystemExit(1) from None
        print(json.dumps(report, ensure_ascii=False, indent=2))
        raise SystemExit(0)
    from reference_api.services import plm
    try:
        print(json.dumps(asyncio.run(audit(args.release_limit)), ensure_ascii=False, indent=2))
    except (plm.PlmRefused, plm.PlmUnavailable) as failure:
        # В отчёт не попадают URL с заголовками HTTP-клиента или документы.
        print(json.dumps({"error": type(failure).__name__, "message": str(failure)}, ensure_ascii=False))
        raise SystemExit(1) from None

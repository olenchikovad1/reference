"""Проверить источник кадров/размеров PLM, не создавая изделий и не копируя каталог.

В контейнере API: python -m scripts.stand.audit_plm_garments.
До восьми релизов, два паспорта и два preview. Ключи и документы не выводятся.
"""

import argparse
import asyncio
from io import BytesIO
import json
import re
from typing import Any

from PIL import Image

from reference_api.config import settings
from reference_api.db import session_factory
from reference_api.services import plm


async def audit(limit: int) -> dict[str, Any]:
    cfg = settings()
    if not cfg.plm_base_url or not cfg.plm_machine_key:
        raise RuntimeError("PLM application channel is not configured")
    base, key = cfg.plm_base_url, cfg.plm_machine_key
    colorways = await plm.list_colorways(base, key)
    async with session_factory() as db:
        enriched = await plm.enrich_colorways(db, colorways)
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
            "working_sample": [{name: item[name] for name in ("id", "article", "style_code", "product_code", "image")}
                               for item in enriched if item["can_work"]][:2],
            "with_image": sum(bool(item["image"]) for item in enriched), "releases_checked": len(releases),
            "release_limit": limit, "white_variants": len(white),
            "white_with_size_range": sum(bool(item["size_range"]) for item in white), "samples": samples}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-limit", type=int, default=8, choices=range(1, 9))
    args = parser.parse_args()
    try:
        print(json.dumps(asyncio.run(audit(args.release_limit)), ensure_ascii=False, indent=2))
    except (plm.PlmRefused, plm.PlmUnavailable) as failure:
        # В отчёт не попадают URL с заголовками HTTP-клиента или документы.
        print(json.dumps({"error": type(failure).__name__, "message": str(failure)}, ensure_ascii=False))
        raise SystemExit(1) from None

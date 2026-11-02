"""Проверка пригодности рендеров PLM без создания изделий и калибровки.

Контейнер API: python -m scripts.garment.probe_plm_frames --releases 8.
Белый цвет и прозрачность проверяются отдельно: название цвета не доказывает
пригодность кадра. Размерный ряд не заменяет физические мерки и калибровку.
"""

import argparse
import asyncio
from collections import Counter
import io
import json

from PIL import Image

from reference_api.config import settings
from reference_api.services import plm


async def probe(limit: int) -> dict:
    cfg = settings()
    releases = await plm.list_releases(cfg.plm_base_url or "", cfg.plm_machine_key or "", limit=limit)
    summary: dict = {"releases": len(releases), "styles": 0, "render_sides": Counter(),
                     "size_ranges": set(), "white_candidates": [], "image_probes": []}
    for release in releases:
        card = await plm.release_card(cfg.plm_base_url or "", cfg.plm_machine_key or "", release["id"])
        for style in card.get("styles", []):
            summary["styles"] += 1
            if style.get("size_range"):
                summary["size_ranges"].add(style["size_range"])
            for colorway in style.get("colorways", []):
                images = colorway.get("images", [])
                summary["render_sides"].update(image.get("side") or "unknown" for image in images)
                rgb = colorway.get("rgb")
                white = rgb and min(rgb) >= 220 and max(rgb) - min(rgb) <= 25
                if white and images:
                    summary["white_candidates"].append({"style": style["code"], "colorway": colorway["id"],
                        "color_code": colorway.get("color_code"), "size_range": style.get("size_range"),
                        "images": images})
    for candidate in summary["white_candidates"][:3]:
        for image in candidate["images"][:2]:
            image_key = image.get("key") or image.get("id") or image.get("image_id")
            if not image_key:
                continue
            try:
                content, media_type = await plm.fetch_image(cfg.plm_base_url or "", cfg.plm_machine_key or "", image_key, "preview")
            except (plm.PlmUnavailable, plm.PlmRefused) as failure:
                summary["image_probes"].append({"style": candidate["style"], "key": image_key,
                                                "error": str(failure)})
                continue
            with Image.open(io.BytesIO(content)) as frame:
                alpha = frame.convert("RGBA").getchannel("A")
                histogram = alpha.histogram()
                summary["image_probes"].append({"style": candidate["style"], "key": image_key,
                    "side": image.get("side"), "size": list(frame.size), "media_type": media_type,
                    "transparent_share": round(sum(histogram[:255]) / (frame.width * frame.height), 4)})
    summary["size_ranges"] = sorted(summary["size_ranges"])
    summary["white_candidates_total"] = len(summary["white_candidates"])
    summary["white_candidates"] = summary["white_candidates"][:3]
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--releases", type=int, default=8, choices=range(1, 21))
    args = parser.parse_args()
    print(json.dumps(asyncio.run(probe(args.releases)), ensure_ascii=False, indent=2))

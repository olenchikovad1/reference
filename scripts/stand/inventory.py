"""Опись примеров и канала PLM без записи и вывода личных черновиков.

Контейнер API: python -m scripts.stand.inventory.
"""

import asyncio
import json

from sqlalchemy import text

from reference_api.config import settings
from reference_api.db import session_factory
from reference_api.repositories import assets
from reference_api.services import plm


async def inventory() -> dict:
    result: dict = {}
    async with session_factory() as db:
        tables = (await db.execute(text(
            "select tablename from pg_tables where schemaname='public' order by tablename"
        ))).scalars().all()
        result["tables"] = {
            name: await db.scalar(text(f'SELECT count(*) FROM "{name}"'))
            for name in tables
        }
        result["references"] = [dict(row) for row in (await db.execute(text(
            "select id, name, status from reference_cards order by id limit 6"
        ))).mappings()]
    cfg = settings()
    objects = assets.client().list_objects_v2(Bucket=cfg.s3_bucket, MaxKeys=1)
    result["storage_has_objects"] = bool(objects.get("Contents"))
    if cfg.plm_base_url and cfg.plm_machine_key:
        colors = await plm.list_colors(cfg.plm_base_url, cfg.plm_machine_key)
        drops = await plm.list_drops(cfg.plm_base_url, cfg.plm_machine_key)
        releases = await plm.list_releases(cfg.plm_base_url, cfg.plm_machine_key)
        result["plm"] = {
            "colors": len(colors), "drops": len(drops), "releases": len(releases),
            "release_samples": releases[:3],
            "color_samples": [vars(color) for color in colors[:4]],
        }
    return result


if __name__ == "__main__":
    print(json.dumps(asyncio.run(inventory()), ensure_ascii=False, indent=2, default=str))

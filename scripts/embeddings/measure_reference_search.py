"""Замер поиска на витрине (US-0498): сколько нужного в первой десятке и
сколько лишнего.

Запросы и ожидания — fixtures/reference_search.yaml, записан до замера.
Ожидания там — дропами; «нужный» референс — живой, на цветомодели
ожидаемого дропа. Лишний — найденный, но не на цветомодели ожидаемого дропа
(у запроса без ожиданий лишний — любой). Печатает по каждому запросу и итог.

    docker compose -f infra/compose.yaml exec -T api python -m scripts.embeddings.measure_reference_search
"""

import asyncio
import pathlib

import yaml

from reference_api.db import session_factory
from reference_api.repositories import references as repo
from reference_api.services import drops as drops_service
from reference_api.services import references

FIX = pathlib.Path("/srv/reference/fixtures")


async def main() -> None:
    queries = yaml.safe_load((FIX / "reference_search.yaml").read_text(encoding="utf-8"))["queries"]
    async with session_factory() as db:
        drops = {d.name: d.id for d in await drops_service.drops(db)}
        rows = await repo.latest(db, limit=10_000)
        places = await drops_service.colour_models_of(db, [c.colour_model_id for c, _ in rows if c.colour_model_id])
        in_drop = {
            card.id: {d.id for d in places[card.colour_model_id].drop_refs}
            for card, _ in rows
            if card.colour_model_id in places
        }
        total_want = total_hit = total_extra = 0
        for q in queries:
            want_drops = {drops[n] for n in q["expect_drops"]}
            want = {r for r, ds in in_drop.items() if ds & want_drops}
            found = [f.reference_id for f in await references.find(db, str(q["q"]))][:10]
            hit = want & set(found)
            extra = [r for r in found if r not in want]
            total_want += len(want)
            total_hit += len(hit)
            total_extra += len(extra)
            print(f"  {q['q']!s:12} нужных {len(want)}, в десятке {len(hit)}, лишних {len(extra)}"
                  f"{' — ' + str(extra) if extra else ''}")
        print(f"\nитого: нужных {total_want}, в десятке {total_hit}, лишних {total_extra}")


if __name__ == "__main__":
    asyncio.run(main())

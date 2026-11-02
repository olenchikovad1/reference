"""Read-only SQL and response profile of showcase/texts, inside the API container.

python -m scripts.stand.profile_lists --repeat 2
Does not start lifespan jobs or change application data. SQL parameters are hidden.
"""

import argparse
import asyncio
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import json
from threading import Lock
import time

import httpx
from sqlalchemy import event

from reference_api.app import create_app
from reference_api.db import engine


def profile_storage(cards: list[dict]) -> None:
    from reference_api.repositories import assets

    digests = list(dict.fromkeys(d for card in cards for d in card["views"].values()))[:8]
    factory = assets.boto3.client
    counter = 0
    lock = Lock()

    def create_client(*args, **kwargs):
        nonlocal counter
        with lock:
            counter += 1
        return factory(*args, **kwargs)

    def read(digest: str) -> int:
        got = assets.get(digest, "thumb")
        if got is None:
            raise RuntimeError("Missing thumbnail")
        return len(got[0])

    assets.boto3.client = create_client
    try:
        for state in ("cold", "warm"):
            started = time.monotonic()
            with ThreadPoolExecutor(max_workers=8) as workers:
                sizes = list(workers.map(read, digests))
            print(json.dumps({"storage": state, "seconds": round(time.monotonic() - started, 3),
                              "clients_created": counter, "images": len(sizes), "bytes": sum(sizes)}), flush=True)
    finally:
        assets.boto3.client = factory


async def main(repeat: int, storage: bool) -> None:
    statements: Counter[str] = Counter()

    def record(conn, cursor, statement, parameters, context, executemany):
        statements[" ".join(statement.split())[:160]] += 1

    event.listen(engine.sync_engine, "before_cursor_execute", record)
    app = create_app()
    cards = []
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://profile") as client:
        for path in ("references", "library/texts", "drops"):
            for iteration in range(repeat):
                statements.clear()
                started = time.monotonic()
                response = await client.get(f"/reference/api/{path}")
                response.raise_for_status()
                rows = response.json()
                if path == "references":
                    cards = rows
                print(json.dumps({"path": path, "run": iteration + 1,
                                  "seconds": round(time.monotonic() - started, 3),
                                  "bytes": len(response.content), "rows": len(rows),
                                  "queries": statements.total(), "sql": statements.most_common(6)},
                                 ensure_ascii=False), flush=True)
    event.remove(engine.sync_engine, "before_cursor_execute", record)
    if storage:
        await asyncio.to_thread(profile_storage, cards)
    await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repeat", type=int, default=1, choices=range(1, 4))
    parser.add_argument("--storage", action="store_true", help="Read 8 thumbnails cold/warm in this isolated process")
    args = parser.parse_args()
    asyncio.run(main(args.repeat, args.storage))

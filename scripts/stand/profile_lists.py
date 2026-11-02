"""Read-only SQL and response profile of showcase/texts, inside the API container.

python -m scripts.stand.profile_lists --repeat 2
Does not start lifespan jobs or change application data. SQL parameters are hidden.
"""

import argparse
import asyncio
from collections import Counter
import json
import time

import httpx
from sqlalchemy import event

from reference_api.app import create_app
from reference_api.db import engine


async def main(repeat: int) -> None:
    statements: Counter[str] = Counter()

    def record(conn, cursor, statement, parameters, context, executemany):
        statements[" ".join(statement.split())[:160]] += 1

    event.listen(engine.sync_engine, "before_cursor_execute", record)
    app = create_app()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://profile") as client:
        for path in ("references", "library/texts", "drops"):
            for iteration in range(repeat):
                statements.clear()
                started = time.monotonic()
                response = await client.get(f"/reference/api/{path}")
                response.raise_for_status()
                rows = response.json()
                print(json.dumps({"path": path, "run": iteration + 1,
                                  "seconds": round(time.monotonic() - started, 3),
                                  "bytes": len(response.content), "rows": len(rows),
                                  "queries": statements.total(), "sql": statements.most_common(6)},
                                 ensure_ascii=False), flush=True)
    event.remove(engine.sync_engine, "before_cursor_execute", record)
    await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repeat", type=int, default=1, choices=range(1, 4))
    asyncio.run(main(parser.parse_args().repeat))

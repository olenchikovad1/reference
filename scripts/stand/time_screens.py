"""Сколько отвечают запросы, которыми грузятся экраны стенда.

Меряет изнутри контейнера, мимо шлюза и без токена платформы: приложение
собирается в режиме «стенд без платформы» (стендовый субъект со всеми
грантами) на той же базе стенда. Так видно, сколько тратит сам сервис, —
если экран грузится долго, а здесь быстро, дело в шлюзе или в браузере.
Каждый запрос — три раза: первый прогревает модели и кэши.

Где: контейнер api. Только чтение.

    docker compose -f infra/compose.yaml exec -T api python -m scripts.stand.time_screens
"""

import asyncio
import time

import httpx

from reference_api.app import create_app

PATHS = [
    "/reference/api/references",
    "/reference/api/drops",
    "/reference/api/assets/library",
    "/reference/api/references/9",
    "/reference/api/people",
]


async def main() -> None:
    app = create_app(without_platform=True)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://stand", timeout=120) as c:
            for path in PATHS:
                spent = []
                for _ in range(3):
                    t = time.perf_counter()
                    r = await c.get(path)
                    spent.append((time.perf_counter() - t) * 1000)
                size = len(r.content)
                print(f"  {path:40} {r.status_code}  {size / 1024:7.0f} КБ  мс: " + ", ".join(f"{s:.0f}" for s in spent))


if __name__ == "__main__":
    asyncio.run(main())

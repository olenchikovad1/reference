"""Стереть с витрины стенда заведомо мусорные карточки — штатным путём.

Владелец: мусорные тестовые данные (карточки без работы) удаляются, а не
объясняются сообщением. Стирается тем же маршрутом, что человек, —
«насовсем» с причиной (US-0499, И-7): журнал и проверки у удаления те же,
картинки библиотеки остаются (решение 0014). Мимо базы, не SQL-ом.

Где: контейнер api, стенд без платформы в процессе скрипта. Только стенд.

    docker compose -f infra/compose.yaml exec -T api python -m scripts.stand.erase_cards "причина" 1 2 3
"""

import asyncio
import sys

import httpx

from reference_api.app import create_app


async def main(reason: str, ids: list[int]) -> None:
    app = create_app(without_platform=True)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://stand") as c:
            for i in ids:
                r = await c.post(f"/reference/api/references/{i}/erase-forever", json={"reason": reason})
                print(f"  №{i}: {r.status_code} {'стёрта' if r.status_code == 204 else r.text}")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    asyncio.run(main(sys.argv[1], [int(x) for x in sys.argv[2:]]))

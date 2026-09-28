"""Люди стенда с ролями в согласовании (план 075, решение 0016).

Согласование — работа нескольких людей: дизайнер отправляет, редакторы
возвращают или принимают, главный редактор принимает окончательно. На
стенде без платформы людей нет, кроме стендового субъекта, — скрипт заводит
их в таблицу ролей тем же маршрутом, что страница «Справочники». Владелец —
своим id платформы (главный редактор), остальные — стендовые (id stand-…):
входа в платформу у них нет, работают от их имени через «я — …» на стенде.

Где: контейнер api, стенд без платформы в процессе скрипта. Только стенд.

    docker compose -f infra/compose.yaml exec -T api python -m scripts.stand.seed_people
"""

import asyncio

import httpx

from reference_api.app import create_app

PEOPLE = [
    # id владельца — субъект офисной платформы (снимок людей, 28.09.2026).
    ("01M25D944QZ15W9WEP9MRQWH6J", "Оленчиков Алексей", "chief"),
    ("stand-ivanova", "Иванова Мария Петровна", "designer"),
    ("stand-kuznetsov", "Кузнецов Дмитрий", "designer"),
    ("stand-petrov", "Петров Олег Игоревич", "editor"),
    ("stand-sidorova", "Сидорова Анна", "editor"),
]


async def main() -> None:
    app = create_app(without_platform=True)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://stand") as c:
            for sid, name, role in PEOPLE:
                r = await c.put(f"/reference/api/people/{sid}", json={"full_name": name, "role": role})
                print(f"  {name}: {role} — {r.status_code}")


if __name__ == "__main__":
    asyncio.run(main())

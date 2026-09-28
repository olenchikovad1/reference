"""Переразметить библиотеку стенда нынешними моделями и дождаться конца.

То же, что кнопка «переразметить библиотеку» на «Принтах» (US-0629), — из
контейнера, без входа в платформу: после смены модели разметки (настройка
general_tagger, аниме-модель, перевод) библиотеку надо разметить заново.
Проход идёт в этом процессе; ход и итог — те же, что в окне.

Где: контейнер api. Только стенд.

    docker compose -f infra/compose.yaml exec -T api python -m scripts.stand.retag_library
"""

import asyncio

from reference_api.db import session_factory
from reference_api.services import retag


async def main() -> None:
    async with session_factory() as db:
        run = await retag.start(db, None)
        run_id = run.id
    print(f"переразметка {run_id}: {run.total} картинок")
    while retag.running():
        await asyncio.sleep(5)
        async with session_factory() as db:
            r = await retag.current(db)
            print(f"  {r.done} из {r.total}")
    async with session_factory() as db:
        r = await retag.current(db)
    print(f"закончено: {r.done} из {r.total}, не удалось {len(r.failed)}")
    for f in r.failed:
        print(f"  не удалось: {f['name']} — {f['reason']}")
    for kind, a in (r.after or {}).items():
        print(f"  {kind}: было {r.before.get(kind, {}).get('сильных тегов в среднем')} → стало {a['сильных тегов в среднем']}")


if __name__ == "__main__":
    asyncio.run(main())

"""Вернуть в хранилище стенда файлы принтов из тома (infra/stand/files/prints).

Хранилище (MinIO) держит оригиналы и ступени картинок библиотеки; если файл
оттуда пропал, библиотека его ещё помнит (вектор, теги), а миниатюра и
превью отвечают 404, и окно не может нарисовать принт. Имя файла в
хранилище — хеш содержимого, поэтому повторная загрузка того же файла кладёт
его ровно туда, где он был. Загружается тем же маршрутом, что кнопка
«добавить файлы».

28.09.2026 понадобился после того, как стирание пробных референсов унесло
принты, записанные в них листом (исправлено: services/references.erase_forever
не трогает картинки библиотеки).

Где: контейнер api, стенд без платформы в процессе скрипта. Только стенд.

    docker compose -f infra/compose.yaml exec -T api python -m scripts.stand.restore_prints
"""

import asyncio
import io
import pathlib

import httpx

from reference_api.app import create_app
from reference_api.repositories import assets as storage

PRINTS = pathlib.Path("/srv/reference/files/prints")


async def main() -> None:
    import hashlib

    files = sorted(p for p in PRINTS.glob("*.png"))
    missing = [p for p in files if storage.get(hashlib.sha256(p.read_bytes()).hexdigest(), "thumb") is None]
    print(f"принтов в томе {len(files)}, в хранилище нет {len(missing)}")
    app = create_app(without_platform=True)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://stand", timeout=120) as c:
            for p in missing:
                r = await c.post("/reference/api/assets", files=[("files", (p.name, io.BytesIO(p.read_bytes()), "image/png"))])
                print(f"  {p.name}: {r.status_code}")
            # Картинки библиотеки, которых нет ни в хранилище, ни в томе, —
            # вернуть их нечем; называются, чтобы о них знали.
            lost = [i["file_name"] for i in (await c.get("/reference/api/assets/library")).json()
                    if storage.get(i["digest"], "thumb") is None]
            print(f"картинок библиотеки без файла: {len(lost)}" + (f" — {', '.join(lost)}" if lost else ""))


if __name__ == "__main__":
    asyncio.run(main())

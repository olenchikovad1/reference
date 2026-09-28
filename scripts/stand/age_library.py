"""Состарить библиотеку стенда: разметка — как до плана 087 (US-0625, US-0626).

Нужен, чтобы проверить переразметку (US-0629) на том, ради чего она есть, —
на библиотеке, размеченной прежней моделью: у картинок нет вида, теги —
только CLIP со словарём языка, аниме-тегов и предупреждений нет. На стенде,
где всё уже распознано новыми моделями, переразметке нечего делать.

Трогает только разметку файлов (asset_kinds, asset_tags, asset_warnings).
Свои теги и скрытые автотеги референсов — не трогает: они и после прохода
обязаны остаться как были, это и проверяется.

Где: контейнер api. Только стенд — боевую базу сюда не направлять.

    docker compose -f infra/compose.yaml exec -T api python -m scripts.stand.age_library
"""

import asyncio

from sqlalchemy import text

from reference_api.db import session_factory
from reference_api.repositories import library as repo
from reference_api.repositories import tags as tag_repo
from reference_api.services import anime, embeddings
from reference_api.services import tags as tagging


async def main() -> None:
    async with session_factory() as db:
        images = await repo.images(db, embeddings.MODEL_NAME)
        for digest, _ in images:
            vec = await tag_repo.vector_of(db, digest, embeddings.MODEL_NAME)
            await db.execute(text("delete from asset_kinds where digest = :d"), {"d": digest})
            await tag_repo.replace(db, digest, anime.model_name(), [])
            await tag_repo.replace_warnings(db, digest, anime.model_name(), [])
            await tag_repo.replace(db, digest, tagging.model_name(),
                                   [(t.code, t.name, t.score) for t in tagging.tag(vec)])
        await db.commit()
    print(f"состарено картинок: {len(images)} — вида нет, теги только CLIP")


if __name__ == "__main__":
    asyncio.run(main())

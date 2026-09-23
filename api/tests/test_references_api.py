"""Узнавание собранного принта: по рисунку, по надписи, по листу целиком.

Проверяется не «сохранение работает», а то, ради чего история заводилась: три
случая должны РАЗЛИЧАТЬСЯ. Один рисунок с разными словами — разная работа, а
разные рисунки с одним слоганом — почти одна и та же; узнавание, которое обе
пары называет одинаково, бесполезно.
"""

import httpx
import pytest_asyncio

from reference_api.app import create_app
from tests.test_assets_api import png, send


@pytest_asyncio.fixture
async def client():
    from sqlalchemy import text

    from reference_api.db import engine

    app = create_app()
    async with app.router.lifespan_context(app):
        async with engine.begin() as conn:
            await conn.execute(
                text("truncate table asset_embeddings, reference_cards, reference_texts")
            )
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://stand"
        ) as c:
            yield c
    await engine.dispose()


async def save(client, *, name, sheet, images, texts):
    r = await client.post(
        "/reference/api/references",
        json={"name": name, "sheet_digest": sheet, "image_digests": list(images), "texts": list(texts)},
    )
    assert r.status_code == 200, r.text
    return r.json()


async def store(client, name: str, width: int, height: int, shade: int) -> str:
    return (await send(client, (name, png(width, height, shade=shade)))).json()[0]["digest"]


async def test_first_reference_recognises_nothing(client) -> None:
    """Первый собранный принт узнавать не в чем."""
    sheet = await store(client, "лист.png", 400, 300, 40)
    pic = await store(client, "рисунок.png", 300, 200, 40)
    saved = await save(client, name="первый", sheet=sheet, images=[pic], texts=["ЛЕТО 2025"])
    assert saved["matches"] == []


async def test_same_picture_other_words_matches_by_picture(client) -> None:
    """Тот же рисунок, другие слова — совпал РИСУНОК, а не надпись.

    Это разная работа, и окно обязано сказать, чем именно они совпали: иначе
    человек решит, что принт уже делали целиком, и не сделает второй.
    """
    sheet1 = await store(client, "лист1.png", 400, 300, 40)
    pic = await store(client, "рисунок.png", 300, 200, 77)
    await save(client, name="первый", sheet=sheet1, images=[pic], texts=["ЛЕТО 2025"])

    sheet2 = await store(client, "лист2.png", 400, 300, 180)
    second = await save(
        client, name="второй", sheet=sheet2, images=[pic], texts=["СИЛА В ПРАВДЕ"]
    )

    by = {m["by"] for m in second["matches"]}
    assert "picture" in by, f"рисунок не узнался: {second['matches']}"
    assert "slogan" not in by, f"надпись узналась, хотя слова другие: {second['matches']}"


async def test_same_words_other_picture_matches_by_slogan(client) -> None:
    """Другой рисунок, те же слова — совпала НАДПИСЬ."""
    sheet1 = await store(client, "лист1.png", 400, 300, 40)
    pic1 = await store(client, "рисунок1.png", 300, 200, 20)
    await save(client, name="первый", sheet=sheet1, images=[pic1], texts=["ЛЕТО 2025"])

    sheet2 = await store(client, "лист2.png", 410, 310, 200)
    pic2 = await store(client, "рисунок2.png", 300, 200, 210)
    second = await save(client, name="второй", sheet=sheet2, images=[pic2], texts=["ЛЕТО 2025"])

    found = [m for m in second["matches"] if m["by"] == "slogan"]
    assert found, f"надпись не узналась: {second['matches']}"
    assert found[0]["level"] == "same", f"точное совпадение названо неточным: {found[0]}"
    assert found[0]["text"] == "ЛЕТО 2025"


async def test_near_words_are_similar_not_same(client) -> None:
    """Близкие слова — «похожая», а не «та же».

    «ЛЕТО 2025» и «ЛЕТО 2024» — разные слоганы, но повод вспомнить прошлый.
    Назвать их одним значит соврать, промолчать — потерять подсказку.
    """
    sheet1 = await store(client, "лист1.png", 400, 300, 40)
    await save(client, name="первый", sheet=sheet1, images=[], texts=["ЛЕТО 2025"])

    sheet2 = await store(client, "лист2.png", 410, 310, 200)
    second = await save(client, name="второй", sheet=sheet2, images=[], texts=["ЛЕТО 2024"])

    found = [m for m in second["matches"] if m["by"] == "slogan"]
    assert found, f"близкая надпись не узналась: {second['matches']}"
    assert found[0]["level"] == "close", f"близкая названа точной: {found[0]}"


async def test_the_same_print_matches_by_the_whole_sheet(client) -> None:
    """Та же пара целиком — совпал ПЕЧАТНЫЙ ЛИСТ.

    Лист — то, что уходит на фабрику, и совпадение по нему означает готовый
    дубль, а не повод посмотреть.
    """
    sheet = await store(client, "лист.png", 400, 300, 40)
    pic = await store(client, "рисунок.png", 300, 200, 40)
    await save(client, name="первый", sheet=sheet, images=[pic], texts=["ЛЕТО 2025"])

    same_sheet = await store(client, "лист-копия.png", 420, 315, 40)
    second = await save(
        client, name="второй", sheet=same_sheet, images=[pic], texts=["ЛЕТО 2025"]
    )

    assert "print" in {m["by"] for m in second["matches"]}, (
        f"лист целиком не узнался: {second['matches']}"
    )


async def test_exact_search_finds_the_words_not_something_about_summer(client) -> None:
    """Точный поиск — полнотекстовый.

    «Где мы писали ЛЕТО 2025» — это точное совпадение. Вектор вернул бы
    «что-то про лето», и человек решил бы, что поиск сломан.
    """
    sheet = await store(client, "лист.png", 400, 300, 40)
    await save(client, name="летний", sheet=sheet, images=[], texts=["ЛЕТО 2025"])
    other = await store(client, "лист2.png", 410, 310, 200)
    await save(client, name="зимний", sheet=other, images=[], texts=["ЗИМА 2025"])

    r = await client.get("/reference/api/references/search", params={"q": "лето 2025"})
    assert r.status_code == 200
    names = [row["name"] for row in r.json()]
    assert names == ["летний"], f"точный поиск вернул не то: {r.json()}"


async def test_the_very_same_sheet_matches_by_print(client) -> None:
    """Тот же лист БАЙТ В БАЙТ — совпадение по листу.

    Поиск по вектору исключает сам себя, и без явного хеша самый частый случай
    молча выпадал: карточка находилась «по рисунку», то есть как РАЗНАЯ работа.
    """
    sheet = await store(client, "лист.png", 400, 300, 40)
    pic = await store(client, "рисунок.png", 300, 200, 40)
    await save(client, name="первый", sheet=sheet, images=[pic], texts=["ЛЕТО 2025"])

    second = await save(client, name="второй", sheet=sheet, images=[pic], texts=["ЛЕТО 2025"])
    by = [m["by"] for m in second["matches"]]
    assert by == ["print"], f"тот же лист не узнался как лист: {second['matches']}"

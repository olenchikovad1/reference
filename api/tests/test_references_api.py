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
                text("truncate table asset_embeddings, reference_cards, reference_versions, reference_texts cascade")
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


WORK = {
    "version": 2,
    "stateCode": "back",
    "colourCode": "BLACK",
    "size": 98,
    "composition": {
        "selectedId": None,
        "elements": [
            {
                "id": "el-a",
                "kind": "image",
                "name": "перед",
                "src": "/x.png",
                "aspect": 1,
                "hasAlpha": True,
                "placement": {"side": "front", "anchor": "neck", "dxCm": 0, "dyCm": 12, "widthCm": 18, "rotation": 0},
            },
            {
                "id": "el-b",
                "kind": "image",
                "name": "спина",
                "src": "/y.png",
                "aspect": 1,
                "hasAlpha": True,
                "placement": {
                    "side": "back",
                    "anchor": "neck",
                    "dxCm": 0,
                    "dyCm": 14,
                    "widthCm": 30,
                    "rotation": 0,
                    "widthBySize": {"98": 24},
                },
            },
        ],
    },
}


async def test_the_whole_work_is_saved_and_opens_as_it_was(client) -> None:
    """Сохраняется работа целиком, а не снимок для узнавания.

    Раньше на сервер уходили лист, картинки и надписи — размещений, цвета и
    исключений размеров там не было, и открыть работу с другого компьютера
    было нечем.
    """
    sheet = await store(client, "лист.png", 400, 300, 40)
    r = await client.post(
        "/reference/api/references",
        json={"name": "работа", "sheet_digest": sheet, "image_digests": [], "texts": [], "work": WORK},
    )
    assert r.status_code == 200, r.text
    card = r.json()["id"]

    opened = await client.get(f"/reference/api/references/{card}")
    assert opened.status_code == 200
    assert opened.json()["work"] == WORK, "работа открылась не такой, какой её сохранили"


async def put(client, reference: int | None, work: dict, sheet: str, texts=(), **extra) -> dict:
    """Сохранить: без номера — новый референс, с номером — новая его версия."""
    url = "/reference/api/references" + (f"/{reference}/versions" if reference else "")
    r = await client.post(url, json={"name": "работа", "sheet_digest": sheet, "image_digests": [],
                                     "texts": list(texts), "work": work, **extra})
    assert r.status_code == 200, r.text
    return r.json()


async def test_saving_again_is_a_new_version_and_the_old_ones_stay(client) -> None:
    """«Сохранить» — новая версия того же референса; прежние не меняются (И-6)."""
    sheet = await store(client, "лист.png", 400, 300, 40)
    first = await put(client, None, WORK, sheet)
    ref = first["id"]
    second = await put(client, ref, {**WORK, "colourCode": "WHITE"}, sheet)
    third = await put(client, ref, {**WORK, "colourCode": "RED"}, sheet)

    assert (first["number"], second["number"], third["number"]) == (1, 2, 3)
    assert second["id"] == third["id"] == ref, "сохранение завело новый референс вместо версии"
    card = (await client.get(f"/reference/api/references/{ref}")).json()
    assert [v["number"] for v in card["versions"]] == [1, 2, 3]
    assert card["number"] == 3 and card["work"]["colourCode"] == "RED", "открывается не последняя версия"
    v1 = (await client.get(f"/reference/api/references/{ref}/versions/1")).json()
    assert v1["work"]["colourCode"] == "BLACK"
    assert all(v["saved_at"] for v in card["versions"]), "у версии нет времени сохранения"


async def test_editing_an_old_version_lands_on_top_not_in_place(client) -> None:
    """Открыли первую, поправили, сохранили — появилась четвёртая, первая та же."""
    sheet = await store(client, "лист.png", 400, 300, 40)
    ref = (await put(client, None, WORK, sheet))["id"]
    await put(client, ref, {**WORK, "colourCode": "WHITE"}, sheet)
    await put(client, ref, {**WORK, "colourCode": "RED"}, sheet)
    old = (await client.get(f"/reference/api/references/{ref}/versions/1")).json()["work"]
    fourth = await put(client, ref, {**old, "size": 98}, sheet)

    assert fourth["number"] == 4
    v1 = (await client.get(f"/reference/api/references/{ref}/versions/1")).json()["work"]
    assert v1 == WORK, "правка старой версии переписала её"


async def test_save_as_is_a_new_reference_that_knows_where_it_came_from(client) -> None:
    """«Сохранить как» — новый референс, у него видно, от какой версии пошёл."""
    sheet = await store(client, "лист.png", 400, 300, 40)
    ref = (await put(client, None, WORK, sheet))["id"]
    await put(client, ref, {**WORK, "colourCode": "WHITE"}, sheet)
    copy = await put(client, None, {**WORK, "colourCode": "WHITE"}, sheet,
                     forked_from={"reference_id": ref, "number": 2})

    assert copy["id"] != ref and copy["number"] == 1
    opened = (await client.get(f"/reference/api/references/{copy['id']}")).json()
    assert opened["forked_from"] == {"reference_id": ref, "number": 2, "name": "работа"}
    assert (await client.get(f"/reference/api/references/{ref}")).json()["forked_from"] is None


async def test_own_versions_are_not_recognised_as_a_repeat(client) -> None:
    """Пятая версия принта, узнавшая четвёртую, ни о чём не говорит."""
    sheet = await store(client, "лист.png", 400, 300, 40)
    ref = (await put(client, None, WORK, sheet, texts=["ЛЕТО 2025"]))["id"]
    again = await put(client, ref, WORK, sheet, texts=["ЛЕТО 2025"])
    assert again["matches"] == [], f"референс узнал сам себя: {again['matches']}"


async def test_a_version_of_an_unknown_reference_is_refused(client) -> None:
    sheet = await store(client, "лист.png", 400, 300, 40)
    r = await client.post("/reference/api/references/999999/versions",
                          json={"sheet_digest": sheet, "work": WORK})
    assert r.status_code == 404
    assert (await client.get("/reference/api/references/1/versions/99")).status_code == 404


async def test_the_list_shows_references_by_their_latest_version(client) -> None:
    """Список — референсы, а не сохранения: у каждого номер последней версии."""
    sheet = await store(client, "лист.png", 400, 300, 40)
    a = (await put(client, None, WORK, sheet))["id"]
    b = (await put(client, None, WORK, sheet))["id"]
    await put(client, a, WORK, sheet)
    listed = (await client.get("/reference/api/references")).json()
    assert [(c["id"], c["number"]) for c in listed][:2] == [(a, 2), (b, 1)], "свежие по последней версии — первыми"


async def test_unknown_card_is_a_404(client) -> None:
    assert (await client.get("/reference/api/references/999999")).status_code == 404

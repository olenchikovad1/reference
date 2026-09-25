"""Поиск по смыслу: слово запроса по векторам картинок, по весу (US-0480).

Проверяется на настоящем наборе стенда — принтах владельца и наборе для
настройки, — а не на нарисованных квадратах: искать смысл в квадрате нечего.
Ожидания записаны в prints.yaml до замера. Правило «ничего не нашлось» и порог
выбраны замером scripts/embeddings/search_rule.py (25.09.2026).
"""

import io
import pathlib

import httpx
import pytest_asyncio
import yaml

from reference_api.app import create_app

PRINTS = pathlib.Path("/srv/reference/files/prints")
FIX = pathlib.Path("/srv/reference/fixtures")


@pytest_asyncio.fixture
async def stand():
    """Клиент и библиотека из всего набора: вес картинки считается относительно
    остальных, и на трёх картинках он меряет не то же, что на тридцати."""
    from sqlalchemy import text

    from reference_api.db import engine

    app = create_app()
    async with app.router.lifespan_context(app):
        async with engine.begin() as conn:
            await conn.execute(text("truncate table asset_embeddings, asset_tags, reference_cards cascade"))
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://stand") as c:
            fx = yaml.safe_load((FIX / "prints.yaml").read_text(encoding="utf-8"))
            names = [e["name"] for e in fx["files"] + fx["tuning_set"]]
            r = await c.post("/reference/api/assets", files=[
                ("files", (n, io.BytesIO((PRINTS / n).read_bytes()), "image/png")) for n in names])
            assert r.status_code == 200, r.text
            digests = {a["name"]: a["digest"] for a in r.json()}
            rec = await c.post("/reference/api/assets/recognise", json=list(digests.values()))
            assert rec.status_code == 200, rec.text
            yield c, digests
    await engine.dispose()


async def search(client, q: str) -> list[dict]:
    r = await client.get("/reference/api/assets/search", params={"q": q})
    assert r.status_code == 200, r.text
    return r.json()


async def test_the_thing_itself_comes_first_and_its_weight_is_shown(stand) -> None:
    client, digests = stand
    found = await search(client, "вертолёт")
    assert found and found[0]["digest"] == digests["mi8-cloud-sharp-clean-print.png"]
    weights = [f["weight"] for f in found]
    assert weights == sorted(weights, reverse=True), "выдача не по весу"


async def test_any_word_form_finds_the_snowy(stand) -> None:
    """Слово не обязано быть тегом и стоять в словарной форме."""
    client, digests = stand
    tanks = {n for n in digests if n.endswith("-print.png") and not n.startswith(("mi8", "ustinov"))}
    for q in ("снежное", "снег"):
        found = await search(client, q)
        assert found and found[0]["name"] in tanks, f"{q}: первым {found[0]['name'] if found else 'ничего'}"


async def test_absent_thing_gives_nothing_not_a_weak_guess(stand) -> None:
    client, _ = stand
    assert await search(client, "жираф") == []


async def test_found_picture_brings_the_cards_it_is_in(stand) -> None:
    client, digests = stand
    heli = digests["mi8-cloud-sharp-clean-print.png"]
    saved = await client.post("/reference/api/references", json={
        "name": "вертолёт на спине", "sheet_digest": heli, "image_digests": [heli], "texts": []})
    assert saved.status_code == 200, saved.text
    found = await search(client, "вертолёт")
    assert [c["id"] for c in found[0]["references"]] == [saved.json()["id"]]
    assert found[0]["references"][0]["name"] == "вертолёт на спине"


async def test_blank_query_is_refused(stand) -> None:
    client, _ = stand
    r = await client.get("/reference/api/assets/search", params={"q": "  "})
    assert r.status_code == 422


async def test_library_page_is_pictures_with_tags_names_and_where_used(stand) -> None:
    """Страница «Принты» (US-0495): картинка одна, сколько бы референсов её ни
    брали; у каждой теги и название, у взятой — «где использован»."""
    client, digests = stand
    heli = digests["mi8-cloud-sharp-clean-print.png"]
    for name in ("вертолёт на спине", "вертолёт на груди"):
        r = await client.post("/reference/api/references", json={
            "name": name, "sheet_digest": heli, "image_digests": [heli], "texts": []})
        assert r.status_code == 200, r.text
    library = (await client.get("/reference/api/assets/library")).json()
    assert {i["digest"] for i in library} == set(digests.values()), "в библиотеке не те картинки"
    item = next(i for i in library if i["digest"] == heli)
    assert sorted(c["name"] for c in item["references"]) == ["вертолёт на груди", "вертолёт на спине"]
    assert any(t["strong"] for t in item["tags"]), "у картинки нет сильных тегов"
    assert item["name"] and item["name"]["name"] == "Ми-8", f"название не пришло: {item['name']}"

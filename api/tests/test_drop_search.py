"""Поиск по смыслу (US-0498): «НГ» находит новогодний дроп, «лето» —
«Пляжную коллекцию 2027», в которой слова «лето» нет, «жираф» — ничего."""

import httpx
import pytest_asyncio

from reference_api.app import create_app
from reference_api.services.drops import expand

HOODIE_RED, HOODIE_WHITE = 4, 2  # красная — в «Новом годе 2027», белая — в «Зиме», «Весне», «Пляжной»


def test_abbreviations_expand_the_query() -> None:
    assert expand("НГ") == "НГ новый год"
    assert expand("23ф") == "23ф 23 февраля"
    assert expand("снег") == "снег"


@pytest_asyncio.fixture
async def client():
    from sqlalchemy import text

    from reference_api.db import engine

    app = create_app()
    async with app.router.lifespan_context(app):
        async with engine.begin() as conn:
            await conn.execute(text("truncate table reference_cards, reference_versions cascade"))
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://stand") as c:
            yield c
    await engine.dispose()


async def save(client, name: str, colour_model: int) -> int:
    r = await client.post("/reference/api/references", json={
        "name": name, "sheet_digest": "d" * 64, "image_digests": [], "texts": [], "colour_model_id": colour_model})
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def find(client, q: str) -> list[dict]:
    return (await client.get("/reference/api/references/find", params={"q": q})).json()


async def test_ng_finds_the_new_year_drop_and_says_why(client) -> None:
    ng = await save(client, "новогодний", HOODIE_RED)
    found = await find(client, "НГ")
    assert found and found[0]["id"] == ng and found[0]["by"] == "drop"
    assert "Новый год 2027" in found[0]["what"]


async def test_summer_finds_the_beach_collection_by_its_months(client) -> None:
    beach = await save(client, "белая", HOODIE_WHITE)
    found = await find(client, "лето")
    assert [f["id"] for f in found] == [beach]
    assert "Пляжная коллекция 2027" in found[0]["what"]


async def test_nothing_gives_nothing(client) -> None:
    await save(client, "белая", HOODIE_WHITE)
    await save(client, "красная", HOODIE_RED)
    assert await find(client, "жираф") == []

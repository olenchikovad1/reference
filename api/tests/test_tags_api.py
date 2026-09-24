"""Автотеги: картинка сама получает теги при загрузке (US-0478).

Проверяется на настоящих принтах владельца, а не на нарисованных квадратах:
теги — это то, что модель видит на картинке, и квадрат ей показать нечего.
Ожидания записаны в prints.yaml до замера.
"""

import io
import pathlib

import httpx
import pytest_asyncio

from reference_api.app import create_app

PRINTS = pathlib.Path("/srv/reference/files/prints")
FRAMES = pathlib.Path("/srv/reference/files/products/B-HDY-14/states")


@pytest_asyncio.fixture
async def client():
    from sqlalchemy import text

    from reference_api.db import engine

    app = create_app()
    async with app.router.lifespan_context(app):
        async with engine.begin() as conn:
            await conn.execute(text("truncate table asset_embeddings, asset_tags"))
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://stand"
        ) as c:
            yield c
    await engine.dispose()


async def tags_of(client, path: pathlib.Path) -> list[dict]:
    r = await client.post(
        "/reference/api/assets",
        files=[("files", (path.name, io.BytesIO(path.read_bytes()), "image/png"))],
    )
    assert r.status_code == 200, r.text
    digest = r.json()[0]["digest"]
    rec = await client.post("/reference/api/assets/recognise", json=[digest])
    assert rec.status_code == 200, rec.text
    return rec.json()[0]["tags"]


async def test_winter_tank_gets_tank_snow_winter(client) -> None:
    names = {t["name"] for t in await tags_of(client, PRINTS / "t72-winter-print.png")}
    assert {"Танк", "Снег", "Зима"} <= names, names


async def test_helicopter_is_a_helicopter_not_a_tank(client) -> None:
    """Вертолёт над снегом — «Вертолёт», и снег с зимой тоже, но не «Танк»."""
    names = {t["name"] for t in await tags_of(client, PRINTS / "mi8-cloud-sharp-clean-print.png")}
    assert "Вертолёт" in names and "Танк" not in names, names
    assert "Снег" in names, names


async def test_general_words_follow_from_the_object(client) -> None:
    """«Техника», «Военное», «Авиация» не угадываются, а следуют из «Вертолёта»:
    поиск «военное» находит и танки, и вертолёты."""
    tags = await tags_of(client, PRINTS / "mi8-cloud-sharp-clean-print.png")
    names = {t["name"] for t in tags}
    assert {"Техника", "Военное", "Авиация"} <= names, names
    score = {t["name"]: t["score"] for t in tags}
    assert score["Военное"] == score["Вертолёт"]


async def test_white_garment_gets_no_tags(client) -> None:
    """Белая толстовка — ни одного тега. Белое не засчитывается за снег: для этого
    у снега в словаре соперник «белый фон»."""
    assert await tags_of(client, FRAMES / "front.png") == []


async def test_each_tag_has_confidence_and_the_model(client) -> None:
    """Уверенность видна числом, модель записана: сменится модель — теги
    пересчитываются, а не смешиваются."""
    for t in await tags_of(client, PRINTS / "is3-winter-print.png"):
        assert 0 < t["score"] <= 1
        assert t["model"]


async def test_stored_tags_are_returned_without_recounting(client) -> None:
    """Теги лежат у файла: страница спрашивает их по имени файла, не загружая
    картинку заново."""
    path = PRINTS / "t72-winter-print.png"
    first = {t["name"] for t in await tags_of(client, path)}
    r = await client.post("/reference/api/assets", files=[("files", (path.name, io.BytesIO(path.read_bytes()), "image/png"))])
    digest = r.json()[0]["digest"]
    got = await client.post("/reference/api/assets/tags", json=[digest])
    assert got.status_code == 200
    assert {t["name"] for t in got.json()[0]["tags"]} == first

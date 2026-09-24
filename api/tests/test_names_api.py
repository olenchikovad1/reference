"""Название изделия на принте — по надёжности (US-0479).

На настоящих принтах владельца: подпись в каталоге набора и та же картинка,
пересохранённая иначе, — это случаи, ради которых название и заводится.
"""

import io
import pathlib

import httpx
import pytest_asyncio
from PIL import Image

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
            await conn.execute(text("truncate table asset_embeddings, asset_tags, asset_names"))
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://stand"
        ) as c:
            yield c
    await engine.dispose()


async def recognise(client, name: str, content: bytes) -> dict:
    r = await client.post("/reference/api/assets", files=[("files", (name, io.BytesIO(content), "image/png"))])
    assert r.status_code == 200, r.text
    digest = r.json()[0]["digest"]
    rec = await client.post("/reference/api/assets/recognise", json=[digest])
    assert rec.status_code == 200, rec.text
    return rec.json()[0]


def halved(path: pathlib.Path) -> bytes:
    """Та же картинка вдвое меньше: хеш другой, вектор тот же (0.992 по замеру
    US-0431)."""
    img = Image.open(path)
    small = img.resize((img.width // 2, img.height // 2))
    out = io.BytesIO()
    small.save(out, format="PNG")
    return out.getvalue()


async def test_print_from_the_set_is_named_by_the_catalogue(client) -> None:
    path = PRINTS / "t72-winter-print.png"
    got = await recognise(client, path.name, path.read_bytes())
    assert got["name"] == {"name": "Т-72", "source": "catalog", "from_digest": None}


async def test_the_same_picture_resaved_inherits_the_name(client) -> None:
    path = PRINTS / "t72-winter-print.png"
    original = await recognise(client, path.name, path.read_bytes())
    copy = await recognise(client, "t72-small.png", halved(path))
    assert copy["name"]["name"] == "Т-72"
    assert copy["name"]["source"] == "inherited"
    assert copy["name"]["from_digest"] == original["digest"]


async def test_another_tank_does_not_inherit(client) -> None:
    """Похожий по теме танк — не та же картинка, и имени он не получает: два
    разных танка похожи сильнее, чем один танк в двух видах."""
    await recognise(client, "t72-winter-print.png", (PRINTS / "t72-winter-print.png").read_bytes())
    other = await recognise(client, "some-tank.png", halved(PRINTS / "t14-armata-print.png"))
    assert other["name"] is None


async def test_unknown_picture_has_no_name_rather_than_a_guess(client) -> None:
    got = await recognise(client, "front.png", (FRAMES / "front.png").read_bytes())
    assert got["name"] is None


async def test_stored_name_comes_with_tags(client) -> None:
    """Страница после перезагрузки спрашивает теги по имени файла — название
    приходит тем же ответом, без повторного узнавания."""
    path = PRINTS / "t72-winter-print.png"
    got = await recognise(client, path.name, path.read_bytes())
    r = await client.post("/reference/api/assets/tags", json=[got["digest"]])
    assert r.json()[0]["name"]["name"] == "Т-72"

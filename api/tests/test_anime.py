"""Аниме размечает аниме-модель — по-русски, с предупреждениями о чужом
персонаже и о взрослом (план 087, US-0626). На настоящих картинках эталона."""

import io
import pathlib
import re

import httpx
import pytest_asyncio

from reference_api.app import create_app
from reference_api.services import anime

PRINTS = pathlib.Path("/srv/reference/files/prints")
LATIN = re.compile(r"[a-z]", re.I)


def test_anime_tags_are_russian_only() -> None:
    r = anime.tag((PRINTS / "anime-sailor-fuku.png").read_bytes())
    names = [t.name for t in r.tags]
    assert "школьная форма" in names and "матроска" in names
    assert not [n for n in names if LATIN.search(n)], names


def test_known_character_gives_a_rights_warning() -> None:
    r = anime.tag((PRINTS / "anime-kasane-teto.png").read_bytes())
    assert [c for c, _ in r.characters] == ["kasane_teto"]
    assert anime.character_warning("kasane_teto") == "похоже на персонажа «Kasane Teto» — проверьте лицензию"
    assert anime.character_warning("saber_(fate)") == "похоже на персонажа «Saber» из «Fate» — проверьте лицензию"


def test_revealing_picture_is_flagged_not_hidden() -> None:
    r = anime.tag((PRINTS / "anime-girl.png").read_bytes())
    assert r.adult, "откровенное — предупреждение"
    assert r.tags, "картинку это не прячет: теги есть"


@pytest_asyncio.fixture
async def client():
    from sqlalchemy import text

    from reference_api.db import engine

    app = create_app()
    async with app.router.lifespan_context(app):
        async with engine.begin() as conn:
            await conn.execute(text("truncate table asset_embeddings, asset_tags, asset_kinds, asset_warnings"))
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://stand"
        ) as c:
            yield c
    await engine.dispose()


async def recognised(client, name: str) -> dict:
    content = (PRINTS / name).read_bytes()
    r = await client.post("/reference/api/assets", files=[("files", (name, io.BytesIO(content), "image/png"))])
    assert r.status_code == 200, r.text
    rec = await client.post("/reference/api/assets/recognise", json=[r.json()[0]["digest"]])
    assert rec.status_code == 200, rec.text
    return rec.json()[0]


async def test_anime_upload_gets_anime_tags_instead_of_household_words(client) -> None:
    got = await recognised(client, "anime-sailor-fuku.png")
    names = {t["name"] for t in got["tags"]}
    assert {"аниме", "школьная форма", "матроска"} <= names
    assert "самурай" not in names and "медсестра" not in names  # прежние бытовые слова CLIP
    assert got["warnings"] == []


async def test_character_warning_reaches_the_library(client) -> None:
    got = await recognised(client, "anime-kasane-teto.png")
    assert {"kind": "character", "text": "похоже на персонажа «Kasane Teto» — проверьте лицензию"} in got["warnings"]
    library = (await client.get("/reference/api/assets/library")).json()
    item = next(i for i in library if i["digest"] == got["digest"])
    assert item["warnings"] == got["warnings"]


async def test_hand_kind_photo_retags_with_the_general_model(client) -> None:
    got = await recognised(client, "anime-sailor-fuku.png")
    r = await client.put(f"/reference/api/assets/{got['digest']}/kind", json={"kind": "photo"})
    assert r.status_code == 200, r.text
    names = {t["name"] for t in r.json()["tags"]}
    assert "школьная форма" not in names and "аниме" not in names

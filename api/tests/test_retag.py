"""Библиотека переразмечается в фоне (план 087, US-0629): устаревшие картинки
находятся, проход идёт до конца, неудача одной не останавливает остальные и
видна с причиной, ход виден снаружи."""

import asyncio
import io
import pathlib

import httpx
import pytest_asyncio
from sqlalchemy import text

from reference_api.app import create_app
from reference_api.db import session_factory
from reference_api.services import anime, retag

PRINTS = pathlib.Path("/srv/reference/files/prints")
NAMES = ["anime-sailor-fuku.png", "rocket.png", "photo-fruits.png"]


@pytest_asyncio.fixture
async def stand():
    from reference_api.db import engine

    app = create_app()
    async with app.router.lifespan_context(app):
        async with engine.begin() as conn:
            await conn.execute(text("truncate table asset_embeddings, asset_tags, asset_kinds, asset_warnings, retag_runs"))
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://stand") as c:
            r = await c.post("/reference/api/assets", files=[
                ("files", (n, io.BytesIO((PRINTS / n).read_bytes()), "image/png")) for n in NAMES])
            digests = {a["name"]: a["digest"] for a in r.json()}
            rec = await c.post("/reference/api/assets/recognise", json=list(digests.values()))
            assert rec.status_code == 200, rec.text
            yield c, digests
    await engine.dispose()


async def make_old(digest: str) -> None:
    """Как у картинки, размеченной до US-0625: вида нет, аниме-тегов нет."""
    async with session_factory() as db:
        await db.execute(text("delete from asset_kinds where digest = :d"), {"d": digest})
        await db.execute(text("delete from asset_tags where digest = :d and model = :m"),
                         {"d": digest, "m": anime.model_name()})
        await db.commit()


async def finish() -> None:
    while retag.running():
        await asyncio.sleep(0.1)


async def test_nothing_is_stale_right_after_recognition(stand) -> None:
    async with session_factory() as db:
        assert await retag.stale(db) == []


async def test_old_picture_is_found_and_retagged_with_the_new_models(stand) -> None:
    client, digests = stand
    old = digests["anime-sailor-fuku.png"]
    await make_old(old)
    async with session_factory() as db:
        assert await retag.stale(db) == [old]
    r = await client.post("/reference/api/assets/retag")
    assert r.status_code == 200, r.text
    assert r.json()["total"] == 1
    await finish()
    status = (await client.get("/reference/api/assets/retag")).json()
    assert (status["done"], status["total"], status["failed"], status["finished"]) == (1, 1, [], True)
    assert status["after"] and status["before"]
    tags = (await client.post("/reference/api/assets/tags", json=[old])).json()[0]["tags"]
    assert "школьная форма" in {t["name"] for t in tags}


async def test_one_failure_is_recorded_and_the_rest_goes_on(stand, monkeypatch) -> None:
    client, digests = stand
    for d in digests.values():
        await make_old(d)
    real = anime.tag

    def broken(content: bytes, model_id: str | None = None):
        raise RuntimeError("модель упала на этой картинке")

    monkeypatch.setattr(anime, "tag", broken)
    await client.post("/reference/api/assets/retag")
    await finish()
    monkeypatch.setattr(anime, "tag", real)
    status = (await client.get("/reference/api/assets/retag")).json()
    assert status["done"] == status["total"] == 3
    assert [f["name"] for f in status["failed"]] == ["anime-sailor-fuku.png"]
    assert "модель упала" in status["failed"][0]["reason"]

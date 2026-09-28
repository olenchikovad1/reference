"""Вид картинки решает, какая модель её размечает (план 087, US-0625).

На настоящих картинках эталона (tag_benchmark.yaml): вид — это манера
рисунка, нарисованному квадрату его не показать.
"""

import io
import pathlib

import httpx
import pytest_asyncio

from reference_api.app import create_app
from reference_api.services import kinds
from reference_api.services.embeddings import embed

PRINTS = pathlib.Path("/srv/reference/files/prints")


def verdict(name: str) -> kinds.Verdict:
    return kinds.classify(embed((PRINTS / name).read_bytes()).vector)


def test_anime_is_anime_and_goes_to_the_anime_model() -> None:
    v = verdict("anime-sailor-fuku.png")
    assert v.kind == "anime"
    assert "anime" in kinds.taggers(v)


def test_snowy_path_is_not_anime_and_goes_to_the_general_model() -> None:
    v = verdict("photo-snowy-path.png")
    assert v.kind != "anime"
    assert kinds.taggers(v) == ["general"]


def test_unsure_picture_goes_to_both_models() -> None:
    sure = kinds.Verdict(kind="anime", second="photo", gap=0.05)
    unsure = kinds.Verdict(kind="photo", second="anime", gap=kinds.gap_min() / 2)
    assert kinds.taggers(sure) == ["anime"]
    assert kinds.taggers(unsure) == ["general", "anime"]
    assert unsure.both and not sure.both


def test_manual_kind_wins_and_is_never_unsure() -> None:
    v = kinds.Verdict(kind="photo", second="anime", gap=0.0, manual="anime")
    assert v.shown == "anime"
    assert kinds.taggers(v) == ["anime"]


@pytest_asyncio.fixture
async def client():
    from sqlalchemy import text

    from reference_api.db import engine

    app = create_app()
    async with app.router.lifespan_context(app):
        async with engine.begin() as conn:
            await conn.execute(text("truncate table asset_embeddings, asset_tags, asset_kinds"))
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


async def test_kind_comes_with_recognition_and_shows_in_the_library(client) -> None:
    got = await recognised(client, "anime-red-suit.png")
    assert got["kind"]["kind"] == "anime"
    assert got["kind"]["name"] == "аниме"
    library = (await client.get("/reference/api/assets/library")).json()
    item = next(i for i in library if i["digest"] == got["digest"])
    assert item["kind"]["kind"] == "anime"
    assert item["kind"]["manual"] is False


async def test_hand_correction_is_kept_and_retags(client) -> None:
    got = await recognised(client, "photo-black-cat.png")
    r = await client.put(f"/reference/api/assets/{got['digest']}/kind", json={"kind": "anime"})
    assert r.status_code == 200, r.text
    assert r.json()["kind"] == {"kind": "anime", "name": "аниме", "second": None, "both": False, "manual": True}
    assert r.json()["tags"], "поправка переразмечает картинку и отдаёт новые теги"
    library = (await client.get("/reference/api/assets/library")).json()
    item = next(i for i in library if i["digest"] == got["digest"])
    assert item["kind"]["kind"] == "anime" and item["kind"]["manual"] is True


async def test_unknown_kind_is_refused(client) -> None:
    got = await recognised(client, "rocket.png")
    r = await client.put(f"/reference/api/assets/{got['digest']}/kind", json={"kind": "мультик"})
    assert r.status_code == 422

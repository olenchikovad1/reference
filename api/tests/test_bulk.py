"""Массовые действия на витрине (US-0501): назначить дроп и скопировать в
дроп — на цветомодели той же модели в его ассортименте; нет модели — отказ
по этой карточке с причиной."""

import httpx
import pytest_asyncio

from reference_api.app import create_app
from tests.test_references_api import WORK

HOODIE_WHITE, HOODIE_BLACK = 2, 1
NEW_YEAR, FEB23 = 2, 3  # в «Новом годе» худи в чёрном и красном, в «23 февраля» худи нет


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


async def white(client) -> int:
    r = await client.post("/reference/api/references", json={
        "name": "белая", "sheet_digest": "e" * 64, "image_digests": [], "texts": [], "work": {**WORK, "colourCode": "WHITE"},
        "colour_model_id": HOODIE_WHITE})
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def card(client, ref: int) -> dict:
    return next(c for c in (await client.get("/reference/api/references")).json() if c["id"] == ref)


async def test_copy_to_a_drop_lands_on_its_colour_model(client) -> None:
    ref = await white(client)
    r = await client.post(f"/reference/api/references/{ref}/copy", params={"drop_id": NEW_YEAR})
    assert r.status_code == 200, r.text
    copy = r.json()["id"]
    got = await card(client, copy)
    assert NEW_YEAR in got["drop_ids"] and got["forked_from_id"] == ref
    work = (await client.get(f"/reference/api/references/{copy}")).json()["work"]
    assert work["colourCode"] == "BLACK", "белой худи в «Новом годе» нет — копия встаёт на первую по коду цвета"
    assert NEW_YEAR not in (await card(client, ref))["drop_ids"], "исходный не должен был сдвинуться"


async def test_assign_drop_moves_and_refuses_with_a_reason(client) -> None:
    ref = await white(client)
    assert (await client.post(f"/reference/api/references/{ref}/drop", params={"drop_id": NEW_YEAR})).status_code == 204
    assert NEW_YEAR in (await card(client, ref))["drop_ids"]
    no = await client.post(f"/reference/api/references/{ref}/drop", params={"drop_id": FEB23})
    assert no.status_code == 422 and "нет модели B-HDY-14" in no.text

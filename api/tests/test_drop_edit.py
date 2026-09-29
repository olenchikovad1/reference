"""Дроп заводят, правят и удаляют созданный по ошибке (US-0719); удалить
можно только пустой — непустой гасят. В ассортимент добавляют цветомодель
и убирают её, пока на ней нет референсов (US-0720)."""

import httpx
import pytest_asyncio

from reference_api.app import create_app

from reference_api.services import colours

API = "/reference/api/drops"
LAST_COLOUR = colours.palette()["colors"][-1]["code"]
BODY = {"name": "Тест US-0719", "season": "SS27", "release_from": "2027-05-01", "release_to": "2027-06-30",
        "audience": "дети", "theme": "проверка"}


@pytest_asyncio.fixture
async def client():
    from sqlalchemy import text

    from reference_api.db import engine

    async def clean() -> None:
        # До и после: справочник дропов общий с test_drops_api — там их считают.
        async with engine.begin() as conn:
            await conn.execute(text("delete from library_drops where drop_id in (select id from drops where name like 'Тест US-07%')"))
            await conn.execute(text("delete from drops where name like 'Тест US-07%'"))
            # Цветомодель, заведённая тестом ассортимента, — последним цветом
            # палитры, которого у сида нет; ни в дропе, ни в референсе её нет.
            await conn.execute(text(
                "delete from colour_models where colour_code = :c and id not in (select colour_model_id from drop_items) "
                "and id not in (select colour_model_id from reference_cards where colour_model_id is not null)"),
                {"c": LAST_COLOUR})

    app = create_app()
    async with app.router.lifespan_context(app):
        await clean()
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://stand") as c:
            yield c
        await clean()
    await engine.dispose()


async def test_create_edit_delete_empty_drop(client):
    r = await client.post(API, json=BODY)
    assert r.status_code == 200, r.text
    drop = r.json()
    assert drop["name"] == BODY["name"] and not drop["retired"]

    r = await client.put(f"{API}/{drop['id']}", json={**BODY, "name": "Тест US-0719 · правка", "release_to": "2027-07-15"})
    assert r.status_code == 200, r.text
    assert r.json()["release_to"] == "2027-07-15"

    assert (await client.delete(f"{API}/{drop['id']}")).status_code == 204
    assert all(d["id"] != drop["id"] for d in (await client.get(API)).json())


async def test_same_name_and_reversed_dates_are_refused(client):
    assert (await client.post(API, json=BODY)).status_code == 200
    assert (await client.post(API, json=BODY)).status_code == 409
    r = await client.post(API, json={**BODY, "name": "Тест US-0719 даты", "release_from": "2027-07-01", "release_to": "2027-06-01"})
    assert r.status_code == 422


async def test_drop_with_proposals_is_not_deleted_but_can_be_retired(client):
    drop = (await client.post(API, json=BODY)).json()
    await client.post("/reference/api/library/texts", json={"text": "Тест US-0719"})
    r = await client.post("/reference/api/library/texts/links", json={"keys": ["ТЕСТ US-0719"], "drop_id": drop["id"]})
    assert r.status_code == 204, r.text

    r = await client.delete(f"{API}/{drop['id']}")
    assert r.status_code == 409
    assert "погасить" in r.json()["detail"]

    r = await client.put(f"{API}/{drop['id']}", json={**BODY, "retired": True})
    assert r.status_code == 200 and r.json()["retired"]


async def test_colour_model_joins_and_leaves_assortment(client):
    drop = (await client.post(API, json=BODY)).json()
    model = next(m for n in (await client.get("/reference/api/catalogue")).json() for m in _models(n) if not m["can_work"])
    colour = LAST_COLOUR
    assert colour not in {cm["colour_code"] for cm in model["colour_models"]}

    r = await client.post(f"{API}/{drop['id']}/items", json={"model_id": model["id"], "colour_code": colour})
    assert r.status_code == 204, r.text
    matrix = (await client.get(f"{API}/{drop['id']}/matrix")).json()
    cell = matrix["rows"][0]["cells"][colour]
    assert matrix["rows"][0]["model"]["id"] == model["id"] and cell["references"] == 0

    # Второй раз — не вторая цветомодель и не вторая строка ассортимента.
    assert (await client.post(f"{API}/{drop['id']}/items", json={"model_id": model["id"], "colour_code": colour})).status_code == 204
    assert len((await client.get(f"{API}/{drop['id']}/matrix")).json()["rows"]) == 1

    assert (await client.delete(f"{API}/{drop['id']}/items/{cell['colour_model_id']}")).status_code == 204
    assert (await client.get(f"{API}/{drop['id']}/matrix")).json()["rows"] == []


async def test_unknown_colour_is_refused(client):
    drop = (await client.post(API, json=BODY)).json()
    model = next(m for n in (await client.get("/reference/api/catalogue")).json() for m in _models(n))
    r = await client.post(f"{API}/{drop['id']}/items", json={"model_id": model["id"], "colour_code": "TEST-0720"})
    assert r.status_code == 422


def _models(node: dict):
    yield from node["models"]
    for c in node["children"]:
        yield from _models(c)

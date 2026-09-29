"""Дроп заводят, правят и удаляют созданный по ошибке (US-0719); удалить
можно только пустой — непустой гасят."""

import httpx
import pytest_asyncio

from reference_api.app import create_app

API = "/reference/api/drops"
BODY = {"name": "Тест US-0719", "season": "SS27", "release_from": "2027-05-01", "release_to": "2027-06-30",
        "audience": "дети", "theme": "проверка"}


@pytest_asyncio.fixture
async def client():
    from sqlalchemy import text

    from reference_api.db import engine

    app = create_app()
    async with app.router.lifespan_context(app):
        async with engine.begin() as conn:
            await conn.execute(text("delete from library_drops where drop_id in (select id from drops where name like 'Тест US-0719%')"))
            await conn.execute(text("delete from drops where name like 'Тест US-0719%'"))
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://stand") as c:
            yield c
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

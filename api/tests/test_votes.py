"""«Нравится» и «не нравится» у принтов и надписей (US-0715): голос у
каждого свой, видно число тех и других и свой голос, второе нажатие —
снять голос."""

import httpx
import pytest_asyncio

from reference_api.app import create_app


@pytest_asyncio.fixture
async def client():
    from sqlalchemy import text

    from reference_api.db import engine

    app = create_app()
    async with app.router.lifespan_context(app):
        async with engine.begin() as conn:
            await conn.execute(text("truncate table library_votes, library_texts cascade"))
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://stand") as c:
            yield c
    await engine.dispose()


async def vote(client, key: str, value: int, who: str) -> None:
    r = await client.post("/reference/api/library/texts/votes", json={"key": key, "value": value},
                          headers={"x-stand-as": who})
    assert r.status_code == 204, r.text


async def votes_of(client, key: str, who: str) -> dict:
    r = await client.get("/reference/api/library/texts", headers={"x-stand-as": who})
    return next(row["votes"] for row in r.json() if row["key"] == key)


async def test_each_person_votes_once_and_sees_own_vote(client):
    await client.post("/reference/api/library/texts", json={"text": "Снег идёт"})
    key = "СНЕГ ИДЁТ"
    await vote(client, key, 1, "anna")
    await vote(client, key, 1, "anna")  # тот же голос второй раз — не второй голос
    await vote(client, key, -1, "boris")
    assert await votes_of(client, key, "anna") == {"up": 1, "down": 1, "mine": 1}
    assert await votes_of(client, key, "boris") == {"up": 1, "down": 1, "mine": -1}

    await vote(client, key, 0, "anna")  # снять голос
    assert await votes_of(client, key, "anna") == {"up": 0, "down": 1, "mine": 0}


async def test_vote_value_is_limited(client):
    r = await client.post("/reference/api/library/texts/votes", json={"key": "X", "value": 5})
    assert r.status_code == 422

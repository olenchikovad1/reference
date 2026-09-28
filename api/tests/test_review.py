"""Статусы и чей ход (план 075, US-0510).

Статус — у карточки: черновик → на согласовании → на доработке → согласован
→ окончательно принят. Переходы — по роли в согласовании (решение 0016).
Чей ход — вычисляется из статуса и ролей, полем не хранится (И-8): «Мои
задачи» собираются вычислением. Работа двоих — через «я — …» стенда.
"""

import io
import pathlib

import httpx
import pytest_asyncio
from sqlalchemy import text

from reference_api.app import create_app

PRINTS = pathlib.Path("/srv/reference/files/prints")
IVANOVA, PETROV, SIDOROVA, CHIEF = "stand-ivanova", "stand-petrov", "stand-sidorova", "stand-chief"
API = "/reference/api"


def as_(who: str) -> dict:
    return {"X-Stand-As": who}


@pytest_asyncio.fixture
async def client():
    from reference_api.db import engine

    app = create_app()
    async with app.router.lifespan_context(app):
        async with engine.begin() as conn:
            await conn.execute(text("truncate table app_people, reference_cards cascade"))
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://stand") as c:
            for who, name, role in [(IVANOVA, "Иванова Мария", "designer"), (PETROV, "Петров Олег", "editor"),
                                    (SIDOROVA, "Сидорова Анна", "editor"), (CHIEF, "Главный Пётр", "chief")]:
                assert (await c.put(f"{API}/people/{who}", json={"full_name": name, "role": role})).status_code == 200
            yield c
    await engine.dispose()


async def digest(client) -> str:
    return (await client.post(f"{API}/assets", files=[
        ("files", ("rocket.png", io.BytesIO((PRINTS / "rocket.png").read_bytes()), "image/png"))])).json()[0]["digest"]


async def new_reference(client) -> int:
    d = await digest(client)
    r = await client.post(f"{API}/references", headers=as_(IVANOVA), json={
        "name": "ракета", "sheet_digest": d, "image_digests": [d], "texts": []})
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def save_version(client, ref: int) -> None:
    d = await digest(client)
    r = await client.post(f"{API}/references/{ref}/versions", headers=as_(IVANOVA), json={
        "name": "ракета левее", "sheet_digest": d, "image_digests": [d], "texts": []})
    assert r.status_code == 200, r.text


async def tasks(client, who: str) -> dict:
    r = await client.get(f"{API}/tasks", headers=as_(who))
    assert r.status_code == 200, r.text
    return r.json()


def ids(rows: list[dict]) -> list[int]:
    return [t["id"] for t in rows]


async def test_the_whole_path_with_turns_computed_from_status_and_roles(client) -> None:
    ref = await new_reference(client)
    assert (await client.get(f"{API}/references/{ref}")).json()["status"] == "draft"

    r = await client.post(f"{API}/references/{ref}/submit", headers=as_(IVANOVA))
    assert r.status_code == 200, r.text
    for editor in (PETROV, SIDOROVA):
        mine = (await tasks(client, editor))["mine"]
        assert ids(mine) == [ref] and mine[0]["reason"] == "на согласовании"
    waiting = (await tasks(client, IVANOVA))["waiting"]
    assert ids(waiting) == [ref] and waiting[0]["reason"] == "ждёт согласования"

    assert (await client.post(f"{API}/references/{ref}/return", headers=as_(PETROV), json={"comment": "  "})).status_code == 422
    r = await client.post(f"{API}/references/{ref}/return", headers=as_(PETROV), json={"comment": "ракету левее на 2 см"})
    assert r.status_code == 200, r.text
    mine = (await tasks(client, IVANOVA))["mine"]
    assert ids(mine) == [ref] and mine[0]["reason"] == "вернули: «ракету левее на 2 см»"
    assert (await tasks(client, SIDOROVA))["mine"] == [], "у второго редактора задача не пропала"

    await save_version(client, ref)
    assert (await client.post(f"{API}/references/{ref}/submit", headers=as_(IVANOVA))).status_code == 200
    assert (await client.post(f"{API}/references/{ref}/approve", headers=as_(SIDOROVA))).status_code == 200
    assert ids((await tasks(client, CHIEF))["mine"]) == [ref]
    assert (await tasks(client, PETROV))["mine"] == []
    assert (await client.post(f"{API}/references/{ref}/approve-final", headers=as_(CHIEF))).status_code == 200

    card = (await client.get(f"{API}/references/{ref}")).json()
    assert card["status"] == "final"
    path = [(e["to"], e["number"], e["by_name"]) for e in card["status_events"]]
    assert path == [("review", 1, "Иванова Мария"), ("rework", 1, "Петров Олег"), ("review", 2, "Иванова Мария"),
                    ("approved", 2, "Сидорова Анна"), ("final", 2, "Главный Пётр")]
    for who in (IVANOVA, PETROV, SIDOROVA, CHIEF):
        assert (await tasks(client, who))["mine"] == []


async def test_a_step_not_of_your_role_is_refused(client) -> None:
    ref = await new_reference(client)
    assert (await client.post(f"{API}/references/{ref}/submit", headers=as_(PETROV))).status_code == 403
    await client.post(f"{API}/references/{ref}/submit", headers=as_(IVANOVA))
    assert (await client.post(f"{API}/references/{ref}/approve", headers=as_(IVANOVA))).status_code == 403
    assert (await client.post(f"{API}/references/{ref}/approve-final", headers=as_(PETROV))).status_code == 409
    card = (await client.get(f"{API}/references/{ref}", headers=as_(IVANOVA))).json()
    assert card["status"] == "review" and card["can"] == []


async def test_editing_an_approved_reference_sends_it_back_to_draft(client) -> None:
    ref = await new_reference(client)
    await client.post(f"{API}/references/{ref}/submit", headers=as_(IVANOVA))
    await client.post(f"{API}/references/{ref}/approve", headers=as_(PETROV))
    await save_version(client, ref)
    card = (await client.get(f"{API}/references/{ref}")).json()
    assert card["status"] == "draft"
    assert card["status_events"][-1]["to"] == "draft" and card["status_events"][-1]["number"] == 2

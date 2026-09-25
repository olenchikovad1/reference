"""Люди приложения: ФИО и наборы прав из платформы (US-0508).

Роли назначает платформа, приложение держит снимок только для чтения и
пересобирает его с нуля: своей выдачи прав нет (запрет 3), своих полей в
снимке нет. Платформа недоступна — прежний снимок остаётся. Человек, у которого
забрали доступ, пропадает из выбора, но имя у его прошлых действий остаётся.
Путь платформы: GET /applications/reference/people с удостоверением pfc_…
(её решение 0025).
"""

import json

import httpx
import pytest_asyncio

from reference_api.app import create_app
from reference_api.services import people

ANNA = {"id": "01ANNA", "display_name": "Анна Петрова", "kind": "internal", "organization_id": "01ORG",
        "right_sets": ["designer"]}
BORIS = {"id": "01BORIS", "display_name": "Борис Иванов", "kind": "internal", "organization_id": "01ORG",
         "right_sets": ["editor", "chief-editor"], "new_field": "терпим"}


def core(status: int, body: dict | None = None) -> httpx.MockTransport:
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers.get("authorization")
        seen["url"] = str(request.url)
        return httpx.Response(status, content=json.dumps(body).encode() if body is not None else b"")

    t = httpx.MockTransport(handler)
    t.seen = seen  # type: ignore[attr-defined]
    return t


@pytest_asyncio.fixture
async def stand():
    from sqlalchemy import text

    from reference_api.db import engine, session_factory

    app = create_app()
    async with app.router.lifespan_context(app):
        async with engine.begin() as conn:
            await conn.execute(text("truncate table people, subject_names"))
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://stand") as c:
            yield c, session_factory
    await engine.dispose()


async def refresh(factory, transport) -> bool:
    async with factory() as db:
        return await people.refresh(db, "http://core:8000", "pfc_secret", transport=transport)


async def test_snapshot_comes_from_the_platform_with_the_credential(stand) -> None:
    client, factory = stand
    t = core(200, {"people": [ANNA, BORIS]})
    assert await refresh(factory, t)
    assert t.seen["auth"] == "Bearer pfc_secret"
    assert t.seen["url"] == "http://core:8000/applications/reference/people"
    designers = (await client.get("/reference/api/people", params={"right_set": "designer"})).json()
    assert [p["display_name"] for p in designers] == ["Анна Петрова"]
    editors = (await client.get("/reference/api/people", params={"right_set": "editor"})).json()
    assert [p["id"] for p in editors] == ["01BORIS"]


async def test_platform_down_keeps_the_previous_snapshot(stand) -> None:
    client, factory = stand
    await refresh(factory, core(200, {"people": [ANNA]}))
    assert not await refresh(factory, core(404))
    assert [p["id"] for p in (await client.get("/reference/api/people")).json()] == ["01ANNA"]


async def test_removed_person_leaves_the_choice_but_keeps_the_name(stand) -> None:
    client, factory = stand
    await refresh(factory, core(200, {"people": [ANNA, BORIS]}))
    await refresh(factory, core(200, {"people": [BORIS]}))
    assert [p["id"] for p in (await client.get("/reference/api/people")).json()] == ["01BORIS"]
    async with factory() as db:
        assert await people.name_of(db, "01ANNA") == "Анна Петрова"


async def test_card_shows_the_name_of_who_saved_it(stand) -> None:
    client, factory = stand
    await refresh(factory, core(200, {"people": [ANNA]}))
    async with factory() as db:
        assert (await people.names_of(db, ["01ANNA", "01NOBODY"])) == {"01ANNA": "Анна Петрова"}


async def test_no_credential_does_not_call_and_keeps_snapshot(stand) -> None:
    client, factory = stand
    async with factory() as db:
        assert not await people.refresh(db, "http://core:8000", None)

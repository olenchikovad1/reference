"""Исполнитель референса и роли в согласовании (план 075, US-0509; решение 0016).

Роль и ФИО ведёт приложение: таблица «человек — роль». Исполнитель — тот,
кто создал; передают его дизайнеру, выбранному по ФИО, и передача видна в
истории. На стенде без платформы «я — …» (заголовок X-Stand-As) действует от
имени другого человека — иначе показать работу двоих нечем.
"""

import io
import pathlib

import httpx
import pytest_asyncio
from sqlalchemy import text

from reference_api.app import create_app
from reference_api.services import people as people_service

PRINTS = pathlib.Path("/srv/reference/files/prints")
ME = people_service.STAND_SUBJECT_ID
IVANOVA = "stand-ivanova"
PETROV = "stand-petrov"
#: Человек с ролью, которого нет ни в снимке платформы, ни среди стендовых:
#: у него забрали доступ.
GONE = "01GONE"


@pytest_asyncio.fixture
async def client():
    from reference_api.db import engine

    app = create_app()
    async with app.router.lifespan_context(app):
        async with engine.begin() as conn:
            await conn.execute(text("truncate table app_people, reference_cards cascade"))
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://stand") as c:
            yield c
    await engine.dispose()


async def role(client, who: str, full_name: str, r: str) -> httpx.Response:
    return await client.put(f"/reference/api/people/{who}", json={"full_name": full_name, "role": r})


async def new_reference(client, headers: dict | None = None) -> int:
    d = (await client.post("/reference/api/assets", files=[
        ("files", ("rocket.png", io.BytesIO((PRINTS / "rocket.png").read_bytes()), "image/png"))])).json()[0]["digest"]
    r = await client.post("/reference/api/references", headers=headers or {}, json={
        "name": "ракета на спине", "sheet_digest": d, "image_digests": [d], "texts": []})
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def test_roles_and_full_names_are_kept_and_known_to_everyone(client) -> None:
    assert (await role(client, IVANOVA, "Иванова Мария Петровна", "designer")).status_code == 200
    assert (await role(client, PETROV, "Петров Олег", "editor")).status_code == 200
    everyone = {p["id"]: p for p in (await client.get("/reference/api/people")).json()}
    assert everyone[IVANOVA]["full_name"] == "Иванова Мария Петровна" and everyone[IVANOVA]["role"] == "designer"
    assert everyone[PETROV]["role"] == "editor"


async def test_unknown_role_and_empty_name_are_refused(client) -> None:
    assert (await role(client, IVANOVA, "Иванова Мария", "начальник")).status_code == 422
    assert (await role(client, IVANOVA, "  ", "designer")).status_code == 422


async def test_creator_is_the_executor_and_work_is_passed_to_a_designer_with_history(client) -> None:
    await role(client, IVANOVA, "Иванова Мария", "designer")
    ref = await new_reference(client)
    card = (await client.get(f"/reference/api/references/{ref}")).json()
    assert card["executor"]["id"] == ME
    r = await client.post(f"/reference/api/references/{ref}/executor", json={"subject_id": IVANOVA})
    assert r.status_code == 200, r.text
    card = (await client.get(f"/reference/api/references/{ref}")).json()
    assert card["executor"] == {"id": IVANOVA, "name": "Иванова Мария", "access": True}
    assert [(t["from_id"], t["to_id"], t["by_id"]) for t in card["transfers"]] == [(ME, IVANOVA, ME)]


async def test_work_goes_only_to_a_designer(client) -> None:
    await role(client, PETROV, "Петров Олег", "editor")
    ref = await new_reference(client)
    r = await client.post(f"/reference/api/references/{ref}/executor", json={"subject_id": PETROV})
    assert r.status_code == 422
    assert "дизайнер" in r.json()["detail"]


async def test_showcase_marks_mine_and_no_access(client) -> None:
    await role(client, IVANOVA, "Иванова Мария", "designer")
    await role(client, GONE, "Уволенный Иван", "designer")
    mine = await new_reference(client)
    hers = await new_reference(client)
    gone = await new_reference(client)
    await client.post(f"/reference/api/references/{hers}/executor", json={"subject_id": IVANOVA})
    r = await client.post(f"/reference/api/references/{gone}/executor", json={"subject_id": GONE})
    assert r.status_code == 422 and "нет доступа" in r.json()["detail"], "тому, кто не откроет, работу не передают"
    # Доступ забрали уже после передачи — исполнитель остаётся, с пометкой.
    from reference_api.db import engine

    async with engine.begin() as conn:
        await conn.execute(text("update reference_cards set executor_id = :g where id = :i"), {"g": GONE, "i": gone})
    cards = {c["id"]: c for c in (await client.get("/reference/api/references")).json()}
    assert cards[mine]["mine"] is True and cards[hers]["mine"] is False
    assert cards[hers]["executor"]["access"] is True
    assert cards[gone]["executor"] == {"id": GONE, "name": "Уволенный Иван", "access": False}
    as_her = {c["id"]: c for c in (await client.get("/reference/api/references", headers={"X-Stand-As": IVANOVA})).json()}
    assert as_her[hers]["mine"] is True and as_her[mine]["mine"] is False


async def test_stand_acts_as_another_person(client) -> None:
    await role(client, IVANOVA, "Иванова Мария", "designer")
    ref = await new_reference(client, headers={"X-Stand-As": IVANOVA})
    card = (await client.get(f"/reference/api/references/{ref}")).json()
    assert card["executor"]["id"] == IVANOVA

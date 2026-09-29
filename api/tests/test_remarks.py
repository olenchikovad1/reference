"""Замечание привязано к месту на изделии и к версии (план 075, US-0511).

Ставит редактор — нажатием на слой (принт, надпись) или на место изделия.
Замечание принадлежит версии: в следующей видно «из версии N». На него
отвечают веткой; исполнитель отмечает «исправлено», автор — «принято» или
«нет, не то». Не удаляется: закрытое остаётся в истории.
"""

import io
import pathlib

import httpx
import pytest_asyncio
from sqlalchemy import text

from reference_api.app import create_app

PRINTS = pathlib.Path("/srv/reference/files/prints")
IVANOVA, PETROV = "stand-ivanova", "stand-petrov"
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
            await c.put(f"{API}/people/{IVANOVA}", json={"full_name": "Иванова Мария", "role": "designer"})
            await c.put(f"{API}/people/{PETROV}", json={"full_name": "Петров Олег", "role": "editor"})
            yield c
    await engine.dispose()


async def reference(client) -> tuple[int, str]:
    d = (await client.post(f"{API}/assets", files=[
        ("files", ("t72.png", io.BytesIO((PRINTS / "t72-winter-print.png").read_bytes()), "image/png"))])).json()[0]["digest"]
    work = {"composition": {"elements": [{"id": "el-tank", "kind": "image", "name": "t72-winter-print.png"}]}}
    r = await client.post(f"{API}/references", headers=as_(IVANOVA), json={
        "name": "танк", "sheet_digest": d, "image_digests": [d], "texts": [], "work": work})
    return r.json()["id"], d


async def new_version(client, ref: int, d: str) -> None:
    r = await client.post(f"{API}/references/{ref}/versions", headers=as_(IVANOVA), json={
        "name": "танк левее", "sheet_digest": d, "image_digests": [d], "texts": []})
    assert r.status_code == 200, r.text


async def remarks(client, ref: int) -> list[dict]:
    r = await client.get(f"{API}/references/{ref}/remarks")
    assert r.status_code == 200, r.text
    return r.json()


async def say(client, ref: int, rid: int, who: str, kind: str, text: str | None = None) -> httpx.Response:
    return await client.post(f"{API}/references/{ref}/remarks/{rid}/messages", headers=as_(who),
                             json={"kind": kind, "text": text})


async def test_remark_on_a_layer_lives_through_versions_with_a_thread(client) -> None:
    ref, d = await reference(client)
    r = await client.post(f"{API}/references/{ref}/remarks", headers=as_(PETROV), json={
        "side": "back", "element_id": "el-tank", "x": 0.42, "y": 0.35, "text": "левее на 2 см"})
    assert r.status_code == 200, r.text
    rid = r.json()["id"]
    [m] = await remarks(client, ref)
    assert (m["number"], m["element_name"], m["status"], m["author_name"]) == (1, "t72-winter-print.png", "open", "Петров Олег")

    await new_version(client, ref, d)
    assert (await say(client, ref, rid, IVANOVA, "fixed")).status_code == 200
    [m] = await remarks(client, ref)
    assert (m["number"], m["status"], m["fixed_in"]) == (1, "fixed", 2), "«из версии 1, исправлено во 2»"

    assert (await say(client, ref, rid, PETROV, "rejected", "нет, не то — ещё левее")).status_code == 200
    [m] = await remarks(client, ref)
    assert m["status"] == "open" and m["fixed_in"] is None
    assert [x["kind"] for x in m["messages"]] == ["fixed", "rejected"]
    assert len(m["messages"]) + 1 == 3, "ветка из трёх сообщений: замечание, исправлено, нет-не-то"


async def test_remark_on_a_place_of_the_garment_and_the_rules_of_who_says_what(client) -> None:
    ref, _ = await reference(client)
    place = await client.post(f"{API}/references/{ref}/remarks", headers=as_(PETROV), json={
        "side": "front", "x": 0.5, "y": 0.2, "text": "на груди пусто"})
    rid = place.json()["id"]
    assert (await remarks(client, ref))[0]["element_id"] is None
    assert (await client.post(f"{API}/references/{ref}/remarks", headers=as_(IVANOVA), json={
        "side": "front", "x": 0.5, "y": 0.2, "text": "сама себе"})).status_code == 403, "замечания ставит редактор"
    assert (await say(client, ref, rid, PETROV, "fixed")).status_code == 403, "«исправлено» — только исполнитель"
    assert (await say(client, ref, rid, IVANOVA, "reply", "там будет надпись")).status_code == 200
    assert (await say(client, ref, rid, IVANOVA, "fixed")).status_code == 200
    assert (await say(client, ref, rid, IVANOVA, "accepted")).status_code == 403, "«принято» — автор или редактор"
    assert (await say(client, ref, rid, PETROV, "accepted")).status_code == 200
    [m] = await remarks(client, ref)
    assert m["status"] == "accepted" and [x["kind"] for x in m["messages"]] == ["reply", "fixed", "accepted"]


async def test_open_remarks_come_first_and_reach_my_tasks(client) -> None:
    ref, _ = await reference(client)
    ids = []
    for t in ["первое", "второе", "третье"]:
        r = await client.post(f"{API}/references/{ref}/remarks", headers=as_(PETROV), json={
            "side": "back", "x": 0.1, "y": 0.1, "text": t})
        ids.append(r.json()["id"])
    await say(client, ref, ids[0], IVANOVA, "fixed")
    await say(client, ref, ids[0], PETROV, "accepted")
    assert [m["status"] for m in await remarks(client, ref)] == ["open", "open", "accepted"]
    await client.post(f"{API}/references/{ref}/submit", headers=as_(IVANOVA))
    await client.post(f"{API}/references/{ref}/return", headers=as_(PETROV), json={"comment": "см. замечания"})
    mine = (await client.get(f"{API}/tasks", headers=as_(IVANOVA))).json()["mine"]
    assert mine[0]["reason"] == "вернули с 2 замечаниями: «см. замечания»"


async def test_remark_is_just_text_without_a_point(client) -> None:
    """План 095: «картинку такую-то доделай так-то» — без нажатия на изделие."""
    ref, _ = await reference(client)
    r = await client.post(f"{API}/references/{ref}/remarks", headers=as_(PETROV), json={"text": "рукав: ракету меньше"})
    assert r.status_code == 200, r.text
    m = r.json()
    assert (m["text"], m["side"], m["x"], m["element_id"]) == ("рукав: ракету меньше", None, None, None)
    half = await client.post(f"{API}/references/{ref}/remarks", headers=as_(PETROV), json={"text": "а", "x": 0.3})
    assert half.status_code == 422, "точка — обе доли или никакой"

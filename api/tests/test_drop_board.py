"""Принты и фразы предлагаются в дроп и одобряются (US-0506).

Статус — у элемента в дропе, решает отдельное право, у отказа причина
обязательна, не одобренное не удаляется, а попавшее через референс одобрения
само не получает.
"""

from fastapi.testclient import TestClient

from reference_api.app import create_app
from tests.test_rights import FixedKeys, bearer
from tests.test_search_api import stand  # noqa: F401 — оснастка: библиотека из набора стенда

NEW_YEAR, FEB23 = 2, 3
HOODIE_RED = 4


async def forget_proposals(drop_id: int, keys: list[str]) -> None:
    """Предложения живут в базе между прогонами (сид в них же, чистить таблицу
    целиком нельзя) — тест убирает только свои, иначе второй прогон находит
    их уже решёнными."""
    from sqlalchemy import text

    from reference_api.db import engine

    async with engine.begin() as conn:
        await conn.execute(text("delete from library_drops where drop_id = :d and key = any(:k)"),
                           {"d": drop_id, "k": keys})


async def board(client, drop_id: int) -> dict:
    r = await client.get(f"/reference/api/drops/{drop_id}/board")
    assert r.status_code == 200, r.text
    return r.json()


async def test_proposed_approved_rejected_with_reason(stand) -> None:  # noqa: F811
    client, digests = stand
    tanks = [digests[n] for n in ("t72-winter-print.png", "is3-winter-print.png", "td-winter-camo-print.png")]
    await forget_proposals(NEW_YEAR, tanks)
    r = await client.post("/reference/api/library/images/links", json={"keys": tanks, "drop_id": NEW_YEAR})
    assert r.status_code == 204, r.text
    got = {i["key"]: i for i in (await board(client, NEW_YEAR))["items"]}
    assert all(got[k]["status"] == "proposed" for k in tanks), "не на доске как предложенные"

    ok = await client.post(f"/reference/api/drops/{NEW_YEAR}/decisions",
                           json={"kind": "image", "keys": tanks[:2], "status": "approved"})
    assert ok.status_code == 204, ok.text
    no_reason = await client.post(f"/reference/api/drops/{NEW_YEAR}/decisions",
                                  json={"kind": "image", "keys": tanks[2:], "status": "rejected"})
    assert no_reason.status_code == 422, "отказ без причины принят"
    no = await client.post(f"/reference/api/drops/{NEW_YEAR}/decisions",
                           json={"kind": "image", "keys": tanks[2:], "status": "rejected", "reason": "слишком мрачно"})
    assert no.status_code == 204
    got = {i["key"]: i for i in (await board(client, NEW_YEAR))["items"]}
    assert [got[k]["status"] for k in tanks] == ["approved", "approved", "rejected"]
    assert got[tanks[2]]["reason"] == "слишком мрачно" and got[tanks[2]]["decided_at"]

    # Не одобренное не снимается: «почему не взяли» спросят позже.
    await client.post("/reference/api/library/images/links", json={"keys": tanks[2:], "drop_id": NEW_YEAR, "remove": True})
    assert tanks[2] in {i["key"] for i in (await board(client, NEW_YEAR))["items"]}
    # Статус — у элемента в дропе: в «23 февраля» тот же танк не отклонён.
    feb = {i["key"]: i["status"] for i in (await board(client, FEB23))["items"]}
    assert feb.get(tanks[2]) != "rejected"


async def test_via_reference_is_shown_apart_and_gets_no_approval(stand) -> None:  # noqa: F811
    client, digests = stand
    heli = digests["mi8-cloud-sharp-clean-print.png"]
    r = await client.post("/reference/api/references", json={
        "name": "вертолёт к Новому году", "sheet_digest": heli, "image_digests": [heli], "texts": [],
        "colour_model_id": HOODIE_RED})
    ref = r.json()["id"]
    b = await board(client, NEW_YEAR)
    assert heli not in {i["key"] for i in b["items"]}, "через референс попал в предложенные"
    assert {"kind": "image", "key": heli, "title": "Ми-8", "references": [ref]} in b["via_references"]


def test_deciding_needs_the_approve_function() -> None:
    app = create_app(without_platform=False)
    app.state.keys = FixedKeys()
    body = {"kind": "image", "keys": ["x"], "status": "approved"}
    with TestClient(app) as c:
        designer = c.post(f"/reference/api/drops/{NEW_YEAR}/decisions", json=body,
                          headers=bearer("drops:view", "prints:write", "drops:write"))
        assert designer.status_code == 404, "дизайнер одобрил сам себе"

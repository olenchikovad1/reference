"""Мои черновики видно, и видно, что в них поменялось (план 092, US-0685).

Прошёл десятки референсов, где-то задел принт мышью — в «моих черновиках»
сказано словами, что изменилось против версии, мелкое помечено «похоже на
случайное» и выбрасывается разом. Вернулся правками к версии — черновика нет.
"""

import copy

from reference_api.services.references import changes
from tests.test_references_api import WORK
from tests.test_trash import client, saved  # noqa: F401 — оснастка того же набора

BASE = {**WORK, "colourCode": "WHITE"}  # вторая версия из saved()
API = "/reference/api/references"


def moved(dx: float = 0, dy: float = 0, rotation: float = 0) -> dict:
    w = copy.deepcopy(BASE)
    p = w["composition"]["elements"][0]["placement"]
    p["dxCm"] += dx
    p["dyCm"] += dy
    p["rotation"] += rotation
    return w


def with_text() -> dict:
    w = copy.deepcopy(BASE)
    w["composition"]["elements"].append({"id": "el-t", "kind": "text", "text": "ЗИМА", "placement": {"side": "front"}})
    return w


def test_changes_are_said_in_words_and_small_ones_look_accidental() -> None:
    assert changes(BASE, moved(dx=0.3)) == (["«перед» сдвинут на 0,3 см вправо"], True)
    said, accidental = changes(BASE, moved(dx=-2, dy=1))
    assert said == ["«перед» сдвинут на 2 см влево, на 1 см ниже"] and not accidental
    assert changes(BASE, moved(rotation=1)) == (["«перед» повёрнут на 1°"], True)
    assert changes(BASE, with_text()) == (["добавлена надпись «ЗИМА»"], False)
    twice = with_text()
    twice["composition"]["elements"].append({**twice["composition"]["elements"][-1], "id": "el-t2"})
    assert changes(BASE, twice)[0] == ["добавлена надпись «ЗИМА» ×2"]
    assert changes(BASE, {**BASE, "colourCode": "BLACK"}) == (["цвет WHITE → BLACK"], False)
    assert changes(BASE, {**BASE, "stateCode": "front", "composition": {**BASE["composition"], "selectedId": "el-a"}}) \
        == ([], False), "сторона, на которую смотрят, и выбранное — не правка"


async def put(client, ref: int, work: dict) -> None:
    assert (await client.put(f"{API}/{ref}/draft", json={"work": work, "base_number": 2})).status_code == 204


async def test_my_drafts_list_and_accidental_ones_go_at_once(client) -> None:
    a, _ = await saved(client)
    b, _ = await saved(client)
    c, _ = await saved(client)
    await put(client, a, moved(dx=0.3))
    await put(client, b, with_text())
    await put(client, c, moved(dy=-0.5))

    mine = (await client.get(f"{API}/drafts/mine")).json()
    assert [m["reference_id"] for m in mine] == [c, b, a], "свежие первыми"
    assert [m["accidental"] for m in mine] == [True, False, True]
    assert mine[1]["changes"] == ["добавлена надпись «ЗИМА»"]

    r = await client.delete(f"{API}/drafts/accidental")
    assert sorted(r.json()) == sorted([a, c])
    assert [m["reference_id"] for m in (await client.get(f"{API}/drafts/mine")).json()] == [b]
    assert (await client.get(f"{API}/{b}")).json()["draft"]["work"] == with_text(), "работа на месте"
    assert (await client.get(f"{API}/{a}")).json()["number"] == 2, "версия не тронута"


async def test_draft_back_to_the_version_is_no_draft(client) -> None:
    a, _ = await saved(client)
    await put(client, a, moved(dx=1))
    await put(client, a, moved())
    assert (await client.get(f"{API}/{a}")).json()["draft"] is None
    assert (await client.get(f"{API}/drafts/mine")).json() == []

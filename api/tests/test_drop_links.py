"""Всё привязано к дропам и адресату (US-0497).

Связь бывает назначенной руками и «через референс»: вторая считается из живых
референсов и уходит вместе с ними — удалённый в корзину референс связей не
даёт, назначенное остаётся.
"""

from tests.test_search_api import stand  # noqa: F401 — оснастка: библиотека из набора стенда

WINTER, NEW_YEAR, FEB23, SUMMER = 1, 2, 3, 5
#: Цветомодель худи стенда в красном — только в «Новом годе 2027» (сид 9d5e2f3a4b61).
HOODIE_RED = 4


async def library(client) -> dict[str, dict]:
    return {i["digest"]: i for i in (await client.get("/reference/api/assets/library")).json()}


def drops_of(item: dict) -> dict[int, int | None]:
    return {d["id"]: d["via"] for d in item["drops"]}


async def test_seeded_links_winter_tanks_are_in_winter(stand) -> None:  # noqa: F811
    client, digests = stand
    items = await library(client)
    for name in ("is3-winter-print.png", "t72-winter-print.png", "td-winter-camo-print.png"):
        item = items[digests[name]]
        assert drops_of(item).get(WINTER, "нет") is None, f"{name}: не назначен зиме"
        assert {"code": "boys", "via": None} in item["audiences"]


async def test_used_in_a_reference_joins_its_drop_and_leaves_with_it(stand) -> None:  # noqa: F811
    client, digests = stand
    heli = digests["mi8-cloud-sharp-clean-print.png"]
    assert NEW_YEAR not in drops_of((await library(client))[heli]), "Ми-8 в «Новом годе» до референса"
    r = await client.post("/reference/api/references", json={
        "name": "вертолёт к Новому году", "sheet_digest": heli, "image_digests": [heli], "texts": ["С НОВЫМ 2027"],
        "colour_model_id": HOODIE_RED})
    assert r.status_code == 200, r.text
    ref = r.json()["id"]

    item = (await library(client))[heli]
    assert drops_of(item)[NEW_YEAR] == ref, "связь не «через референс №…»"
    assert {"code": "girls", "via": ref} in item["audiences"], "адресат не от модели"
    assert item["categories"] == ["Худи"]
    card = next(c for c in (await client.get("/reference/api/references")).json() if c["id"] == ref)
    assert (card["drop_ids"], card["audience"], card["category"]) == ([NEW_YEAR], "girls", "Худи")
    text = next(t for t in (await client.get("/reference/api/library/texts")).json() if t["key"] == "С НОВЫМ 2027")
    assert {d["id"]: d["via"] for d in text["drops"]} == {NEW_YEAR: ref}

    await client.post(f"/reference/api/references/{ref}/trash")
    item = (await library(client))[heli]
    assert NEW_YEAR not in drops_of(item), "референс в корзине, а связь через него осталась"
    assert heli in {i["digest"] for i in (await client.get("/reference/api/assets/search", params={"q": "вертолёт"})).json()}


async def test_assigning_several_at_once_and_retired_is_refused(stand) -> None:  # noqa: F811
    client, digests = stand
    keys = [digests[n] for n in ("pizza.png", "rocket.png", "robot-kawaii.png")]
    r = await client.post("/reference/api/library/images/links", json={"keys": keys, "drop_id": FEB23})
    assert r.status_code == 204, r.text
    items = await library(client)
    assert all(drops_of(items[k]).get(FEB23, "нет") is None for k in keys)
    retired = await client.post("/reference/api/library/images/links", json={"keys": keys[:1], "drop_id": SUMMER})
    assert retired.status_code == 422 and "погашен" in retired.text
    both = await client.post("/reference/api/library/images/links", json={"keys": keys, "drop_id": FEB23, "audience": "boys"})
    assert both.status_code == 422
    await client.post("/reference/api/library/images/links", json={"keys": keys, "drop_id": FEB23, "remove": True})
    assert all(FEB23 not in drops_of(i) for k, i in (await library(client)).items() if k in keys)


async def test_texts_are_assigned_by_their_words(stand) -> None:  # noqa: F811
    client, _ = stand
    await client.post("/reference/api/library/texts", json={"text": "ЗАЩИТНИКАМ"})
    r = await client.post("/reference/api/library/texts/links", json={"keys": ["защитникам"], "audience": "boys"})
    assert r.status_code == 204, r.text
    row = next(t for t in (await client.get("/reference/api/library/texts")).json() if t["key"] == "ЗАЩИТНИКАМ")
    assert row["audiences"] == [{"code": "boys", "via": None}]
    await client.post("/reference/api/library/texts/links", json={"keys": ["ЗАЩИТНИКАМ"], "audience": "boys", "remove": True})

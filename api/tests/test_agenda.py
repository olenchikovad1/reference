"""Выдвинуть на обсуждение и повестка встречи (план 097)."""

from tests.test_review import API, CHIEF, IVANOVA, PETROV, as_, client, new_reference  # noqa: F401


async def test_propose_for_discussion_marks_the_card_without_changing_status(client) -> None:
    ref = await new_reference(client)
    r = await client.post(f"{API}/references/{ref}/agenda", headers=as_(PETROV), json={"reason": "сюжет спорный для детского"})
    assert r.status_code == 200, r.text
    assert [a["reason"] for a in r.json()] == ["сюжет спорный для детского"]
    await client.post(f"{API}/references/{ref}/agenda", headers=as_(IVANOVA), json={"reason": "цвет под вопросом"})
    card = next(c for c in (await client.get(f"{API}/references")).json() if c["id"] == ref)
    assert card["agenda"] == ["сюжет спорный для детского", "цвет под вопросом"] and card["status"] == "draft"
    assert (await client.post(f"{API}/references/{ref}/agenda", headers=as_(PETROV), json={"reason": " "})).status_code == 422
    assert (await client.delete(f"{API}/references/{ref}/agenda", headers=as_(CHIEF))).status_code == 204
    card = next(c for c in (await client.get(f"{API}/references")).json() if c["id"] == ref)
    assert card["agenda"] == [], "снято вручную"


async def test_agenda_since_last_meeting_and_meeting_closes_it(client) -> None:
    liked, returned, talk = [await new_reference(client) for _ in range(3)]
    await client.post(f"{API}/references/{liked}/approve", headers=as_(PETROV))
    await client.post(f"{API}/references/{returned}/return", headers=as_(PETROV), json={"comment": "ракету меньше"})
    await client.post(f"{API}/references/{talk}/agenda", headers=as_(PETROV), json={"reason": "спорный сюжет"})

    a = (await client.get(f"{API}/agenda")).json()
    assert [p["reference_id"] for p in a["proposed"]] == [talk]
    assert [e["reference_id"] for e in a["approved"]] == [liked]
    assert [(e["reference_id"], e["comment"]) for e in a["rework"]] == [(returned, "ракету меньше")]

    assert (await client.post(f"{API}/agenda/meetings", headers=as_(IVANOVA))).status_code == 403, "закрывает редактор"
    after = (await client.post(f"{API}/agenda/meetings", headers=as_(CHIEF))).json()
    assert (after["proposed"], after["approved"], after["rework"]) == ([], [], []), "новая повестка пуста"
    m = after["meetings"][0]["id"]
    past = (await client.get(f"{API}/agenda?meeting={m}")).json()
    assert [p["reference_id"] for p in past["proposed"]] == [talk] and [e["reference_id"] for e in past["approved"]] == [liked]
    card = next(c for c in (await client.get(f"{API}/references")).json() if c["id"] == talk)
    assert card["agenda"] == [], "обсуждённое снято"

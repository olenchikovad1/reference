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



async def test_agenda_lists_what_needs_discussion_until_decided(client) -> None:
    """План 098: повестка — выдвинутое на обсуждение; решили — ушло с неё.
    Встреч в приложении нет."""
    one, two = await new_reference(client), await new_reference(client)
    await client.post(f"{API}/references/{one}/agenda", headers=as_(PETROV), json={"reason": "спорный сюжет"})
    await client.post(f"{API}/references/{two}/agenda", headers=as_(IVANOVA), json={"reason": "цвет под вопросом"})
    a = (await client.get(f"{API}/agenda")).json()
    assert sorted(p["reference_id"] for p in a) == sorted([one, two])
    assert next(p for p in a if p["reference_id"] == one)["reasons"][0]["reason"] == "спорный сюжет"

    assert (await client.post(f"{API}/references/{one}/approve", headers=as_(PETROV))).status_code == 200
    assert [p["reference_id"] for p in (await client.get(f"{API}/agenda")).json()] == [two], "решили — ушло с повестки"
    assert (await client.post(f"{API}/agenda/meetings", headers=as_(CHIEF))).status_code in (404, 405), "встреч нет"

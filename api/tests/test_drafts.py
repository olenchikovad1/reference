"""Черновик между версиями (US-0598).

Правило — «правка живёт в черновике человека, пока не станет версией» — держат
пути: запись, открытие карточки, «Сохранить», «Сохранить как», витрина и
удаление карточки.
"""

from sqlalchemy import text

from reference_api.db import engine
from tests.test_references_api import WORK
from tests.test_trash import client, saved  # noqa: F401 — оснастка того же набора

MOVED = {**WORK, "colourCode": "BLACK"}


async def put(client, path: str, work: dict, base: int | None) -> int:
    return (await client.put(path, json={"work": work, "base_number": base})).status_code


async def test_draft_is_written_and_comes_back_with_the_card(client) -> None:
    ref, _ = await saved(client)
    assert (await client.get(f"/reference/api/references/{ref}")).json()["draft"] is None
    assert await put(client, f"/reference/api/references/{ref}/draft", MOVED, 2) == 204
    # Повторная запись — поверх, а не второй строкой.
    assert await put(client, f"/reference/api/references/{ref}/draft", {**MOVED, "size": 98}, 2) == 204
    opened = (await client.get(f"/reference/api/references/{ref}")).json()
    assert opened["number"] == 2, "черновик не версия"
    assert opened["draft"]["work"]["size"] == 98 and opened["draft"]["base_number"] == 2


async def test_save_turns_draft_into_version(client) -> None:
    ref, image = await saved(client)
    await put(client, f"/reference/api/references/{ref}/draft", MOVED, 2)
    r = await client.post(f"/reference/api/references/{ref}/versions", json={
        "name": "работа", "sheet_digest": image, "image_digests": [image], "texts": [], "work": MOVED})
    assert r.status_code == 200, r.text
    assert (await client.get(f"/reference/api/references/{ref}")).json()["draft"] is None


async def test_save_as_takes_draft_away_from_the_original(client) -> None:
    ref, image = await saved(client)
    await put(client, f"/reference/api/references/{ref}/draft", MOVED, 2)
    r = await client.post("/reference/api/references", json={
        "name": "другая", "sheet_digest": image, "image_digests": [image], "texts": [], "work": MOVED,
        "forked_from": {"reference_id": ref, "number": 2}})
    assert r.status_code == 200, r.text
    assert (await client.get(f"/reference/api/references/{ref}")).json()["draft"] is None


async def test_new_work_has_its_own_draft_until_first_save(client) -> None:
    assert (await client.get("/reference/api/references/drafts/new")).json() is None
    assert await put(client, "/reference/api/references/drafts/new", WORK, None) == 204
    assert (await client.get("/reference/api/references/drafts/new")).json()["work"] == WORK
    await saved(client)
    assert (await client.get("/reference/api/references/drafts/new")).json() is None


async def test_showcase_marks_own_and_others_drafts(client) -> None:
    ref, _ = await saved(client)
    await put(client, f"/reference/api/references/{ref}/draft", MOVED, 2)
    async with engine.begin() as conn:
        await conn.execute(text(
            "insert into reference_drafts (reference_id, author_id, base_number, work) "
            "values (:r, 'ivanov', 2, '{}')"), {"r": ref})
    card = next(c for c in (await client.get("/reference/api/references")).json() if c["id"] == ref)
    assert card["my_draft"] is True
    assert card["others_drafts"] == ["ivanov"]


async def test_discarded_draft_is_gone_and_trashed_card_takes_none(client) -> None:
    ref, _ = await saved(client)
    await put(client, f"/reference/api/references/{ref}/draft", MOVED, 2)
    assert (await client.delete(f"/reference/api/references/{ref}/draft")).status_code == 204
    assert (await client.get(f"/reference/api/references/{ref}")).json()["draft"] is None
    await client.post(f"/reference/api/references/{ref}/trash")
    assert await put(client, f"/reference/api/references/{ref}/draft", MOVED, 2) == 404


async def test_erased_card_takes_its_drafts_along(client) -> None:
    ref, _ = await saved(client)
    await put(client, f"/reference/api/references/{ref}/draft", MOVED, 2)
    await client.post(f"/reference/api/references/{ref}/trash")
    assert (await client.delete(f"/reference/api/references/{ref}")).status_code == 204
    async with engine.begin() as conn:
        left = (await conn.execute(text("select count(*) from reference_drafts where reference_id = :r"), {"r": ref}))
        assert left.scalar_one() == 0


async def test_auto_version_says_before_what_and_takes_the_draft(client) -> None:
    """US-0599: черновик стал версией сам перед переходом — и видно, перед каким."""
    ref, image = await saved(client)
    await put(client, f"/reference/api/references/{ref}/draft", MOVED, 2)
    r = await client.post(f"/reference/api/references/{ref}/versions", json={
        "name": "работа", "sheet_digest": image, "image_digests": [image], "texts": [], "work": MOVED,
        "auto_reason": "перед выгрузкой листа"})
    assert r.status_code == 200, r.text
    opened = (await client.get(f"/reference/api/references/{ref}")).json()
    assert [v["auto_reason"] for v in opened["versions"]] == [None, None, "перед выгрузкой листа"]
    assert opened["draft"] is None


async def test_own_order_is_personal_and_whole(client) -> None:
    """US-0601: свой порядок витрины — у смотрящего; повтор и чужой номер — отказ."""
    a, _ = await saved(client)
    b, _ = await saved(client)
    assert (await client.put("/reference/api/references/order", json={"ids": [a, b]})).status_code == 204
    cards = {c["id"]: c for c in (await client.get("/reference/api/references")).json()}
    assert (cards[a]["my_position"], cards[b]["my_position"]) == (0, 1)
    assert (await client.put("/reference/api/references/order", json={"ids": [b, a]})).status_code == 204
    cards = {c["id"]: c for c in (await client.get("/reference/api/references")).json()}
    assert (cards[b]["my_position"], cards[a]["my_position"]) == (0, 1)
    assert (await client.put("/reference/api/references/order", json={"ids": [a, a]})).status_code == 422
    assert (await client.put("/reference/api/references/order", json={"ids": [a, 99999]})).status_code == 422

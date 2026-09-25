"""Копия и корзина (US-0494, решение 0014).

Правило одно — «удалённое возвращается до очистки, а стирается только из
корзины» — и держать его обязаны все пути: удалить, восстановить, стереть,
очистка по сроку, копия.
"""

import datetime

import httpx
import pytest_asyncio
from fastapi.testclient import TestClient

from reference_api.app import create_app
from tests.test_assets_api import png, send
from tests.test_references_api import WORK
from tests.test_rights import FixedKeys, bearer


@pytest_asyncio.fixture
async def client():
    from sqlalchemy import text

    from reference_api.db import engine

    app = create_app()
    async with app.router.lifespan_context(app):
        async with engine.begin() as conn:
            await conn.execute(text("truncate table asset_embeddings, reference_cards, reference_versions cascade"))
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://stand") as c:
            yield c
    await engine.dispose()


async def saved(client, texts=("ЗИМА 2026",)) -> tuple[int, str]:
    image = (await send(client, ("рисунок.png", png(300, 200, shade=90)))).json()[0]["digest"]
    r = await client.post("/reference/api/references", json={
        "name": "работа", "sheet_digest": image, "image_digests": [image], "texts": list(texts), "work": WORK})
    assert r.status_code == 200, r.text
    ref = r.json()["id"]
    r = await client.post(f"/reference/api/references/{ref}/versions", json={
        "name": "работа", "sheet_digest": image, "image_digests": [image], "texts": list(texts),
        "work": {**WORK, "colourCode": "WHITE"}})
    assert r.status_code == 200, r.text
    return ref, image


async def ids(client, path: str = "/reference/api/references") -> list[int]:
    return [c["id"] for c in (await client.get(path)).json()]


async def test_copy_is_the_last_version_and_knows_where_it_came_from(client) -> None:
    ref, _ = await saved(client)
    r = await client.post(f"/reference/api/references/{ref}/copy")
    assert r.status_code == 200, r.text
    copy = r.json()["id"]
    assert copy != ref and r.json()["number"] == 1
    card = next(c for c in (await client.get("/reference/api/references")).json() if c["id"] == copy)
    assert card["forked_from_id"] == ref
    opened = (await client.get(f"/reference/api/references/{copy}")).json()
    assert opened["work"]["colourCode"] == "WHITE", "копия не с последней версии"
    assert opened["forked_from"]["reference_id"] == ref and opened["forked_from"]["number"] == 2


async def test_trashed_is_gone_from_showcase_and_search_and_comes_back_whole(client) -> None:
    ref, _ = await saved(client)
    assert (await client.post(f"/reference/api/references/{ref}/trash")).status_code == 204
    assert ref not in await ids(client)
    assert ref not in [f["id"] for f in (await client.get("/reference/api/references/find", params={"q": "ЗИМА 2026"})).json()]
    trash = (await client.get("/reference/api/references/trash")).json()
    item = next(c for c in trash if c["id"] == ref)
    deleted = datetime.datetime.fromisoformat(item["deleted_at"])
    assert datetime.datetime.fromisoformat(item["purge_at"]) - deleted == datetime.timedelta(days=30)

    assert (await client.post(f"/reference/api/references/{ref}/restore")).status_code == 204
    assert ref in await ids(client) and ref not in await ids(client, "/reference/api/references/trash")
    opened = (await client.get(f"/reference/api/references/{ref}")).json()
    assert [v["number"] for v in opened["versions"]] == [1, 2], "история не вернулась целиком"


async def test_erase_only_from_trash_and_the_picture_stays(client) -> None:
    ref, image = await saved(client)
    assert (await client.delete(f"/reference/api/references/{ref}")).status_code == 409, "живой стёрся мимо корзины"
    await client.post(f"/reference/api/references/{ref}/trash")
    assert (await client.delete(f"/reference/api/references/{ref}")).status_code == 204
    assert (await client.get(f"/reference/api/references/{ref}")).status_code == 404
    assert ref not in await ids(client, "/reference/api/references/trash")
    assert (await client.get(f"/reference/api/assets/{image}/thumb")).status_code == 200, "картинка ушла вместе с референсом"


async def test_copy_survives_when_its_origin_is_erased(client) -> None:
    ref, _ = await saved(client)
    copy = (await client.post(f"/reference/api/references/{ref}/copy")).json()["id"]
    await client.post(f"/reference/api/references/{ref}/trash")
    assert (await client.delete(f"/reference/api/references/{ref}")).status_code == 204
    opened = (await client.get(f"/reference/api/references/{copy}")).json()
    assert opened["forked_from"] is None and opened["work"]["colourCode"] == "WHITE"


async def test_old_trash_is_erased_by_the_clock(client) -> None:
    from sqlalchemy import text

    from reference_api.db import engine, session_factory
    from reference_api.services import references

    old, _ = await saved(client)
    fresh, _ = await saved(client)
    await client.post(f"/reference/api/references/{old}/trash")
    await client.post(f"/reference/api/references/{fresh}/trash")
    async with engine.begin() as conn:
        await conn.execute(text("update reference_cards set deleted_at = now() - interval '31 days' where id = :id"),
                           {"id": old})
    async with session_factory() as db:
        assert await references.purge_expired(db) == 1
    left = await ids(client, "/reference/api/references/trash")
    assert old not in left and fresh in left, "срок корзины посчитан не так"


def test_rights_trash_needs_delete_and_erase_needs_the_function() -> None:
    app = create_app(without_platform=False)
    app.state.keys = FixedKeys()
    with TestClient(app) as c:
        assert c.post("/reference/api/references/1/trash", headers=bearer("references:write")).status_code == 404
        erase = c.delete("/reference/api/references/1", headers=bearer("references:write", "references:delete"))
        assert erase.status_code == 404, "стереть насовсем можно без функции очистки корзины"

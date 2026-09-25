"""Дропы и их ассортимент (US-0489).

Справочники свои и заполнены сразу (миграция наполнения): пять дропов, одна
модель с кадрами — худи стенда — и три без. Проверяется то, ради чего всё это:
видно, какие цветомодели выходят в дропе и для каких принт уже нарисован, а на
модели без кадров работу не начать — и причина названа.
"""

import httpx
import pytest_asyncio

from reference_api.app import create_app

CARD = {"name": "проба", "sheet_digest": "c" * 64, "image_digests": [], "texts": []}


@pytest_asyncio.fixture
async def client():
    from sqlalchemy import text

    from reference_api.db import engine

    app = create_app()
    async with app.router.lifespan_context(app):
        async with engine.begin() as conn:
            await conn.execute(text("truncate table reference_cards cascade"))
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://stand") as c:
            yield c
    await engine.dispose()


async def drop_named(client, name: str) -> dict:
    return next(d for d in (await client.get("/reference/api/drops")).json() if d["name"] == name)


async def test_five_drops_and_the_retired_one_is_marked(client) -> None:
    drops = (await client.get("/reference/api/drops")).json()
    assert len(drops) == 5
    assert [d["name"] for d in drops if d["retired"]] == ["Лето 2026"]
    active = (await client.get("/reference/api/drops", params={"active": "true"})).json()
    assert "Лето 2026" not in [d["name"] for d in active]
    winter = await drop_named(client, "Зима 2026/27")
    assert winter["season"] == "AW26" and winter["audience"] and winter["release_from"] <= winter["release_to"]


async def test_winter_matrix_is_models_by_colours_and_empty_cell_is_not_drawn_yet(client) -> None:
    winter = await drop_named(client, "Зима 2026/27")
    m = (await client.get(f"/reference/api/drops/{winter['id']}/matrix")).json()
    by_model = {r["model"]["code"]: r for r in m["rows"]}
    assert len(by_model["B-HDY-14"]["cells"]) == 3 and len(by_model["G-SWT-03"]["cells"]) == 2
    black = by_model["B-HDY-14"]["cells"]["BLACK"]
    assert black["references"] == 0  # «ещё не нарисовано»
    assert {c["code"] for c in m["colours"]} >= {"BLACK", "WHITE", "VIOLET"}


async def test_reference_on_a_colour_model_is_counted_in_its_cell(client) -> None:
    winter = await drop_named(client, "Зима 2026/27")
    m = (await client.get(f"/reference/api/drops/{winter['id']}/matrix")).json()
    black = next(r for r in m["rows"] if r["model"]["code"] == "B-HDY-14")["cells"]["BLACK"]
    saved = await client.post("/reference/api/references", json={**CARD, "colour_model_id": black["colour_model_id"]})
    assert saved.status_code == 200, saved.text
    m = (await client.get(f"/reference/api/drops/{winter['id']}/matrix")).json()
    assert next(r for r in m["rows"] if r["model"]["code"] == "B-HDY-14")["cells"]["BLACK"]["references"] == 1


async def test_model_without_frames_cannot_start_and_the_reason_is_named(client) -> None:
    ny = await drop_named(client, "Новый год 2027")
    m = (await client.get(f"/reference/api/drops/{ny['id']}/matrix")).json()
    tee = next(r for r in m["rows"] if r["model"]["code"] == "B-TSH-07")
    assert tee["model"]["can_work"] is False and tee["model"]["reason"] == "у изделия нет кадров для работы"
    cell = next(iter(tee["cells"].values()))
    r = await client.post("/reference/api/references", json={**CARD, "colour_model_id": cell["colour_model_id"]})
    assert r.status_code == 422 and "нет кадров" in r.text


async def test_products_tree_shows_hierarchy_with_colour_models_and_their_drops(client) -> None:
    tree = (await client.get("/reference/api/catalogue")).json()
    kids = tree[0]
    assert kids["name"] == "Детское" and kids["level"] == "direction"
    girls = next(n for n in kids["children"] if n["name"] == "Девочки")
    hoodies = next(n for n in girls["children"][0]["children"] if n["name"] == "Худи")
    hdy = next(m for m in hoodies["models"] if m["code"] == "B-HDY-14")
    assert hdy["can_work"] is True
    assert {"Зима 2026/27", "Новый год 2027"} <= {d for cm in hdy["colour_models"] for d in cm["drops"]}

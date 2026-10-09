"""Семейство цветов модели в дропе (US-0890, решение 0019)."""

import io
import pathlib

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import text

from reference_api.app import create_app

PRINTS = pathlib.Path("/srv/reference/files/prints")
API = "/reference/api"
IVANOVA = "stand-ivanova"


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
            assert (
                await c.put(f"{API}/people/{IVANOVA}", json={"full_name": "Иванова Анна", "role": "designer"})
            ).status_code == 200
            yield c


async def digest(client) -> str:
    return (
        await client.post(
            f"{API}/assets",
            files=[("files", ("rocket.png", io.BytesIO((PRINTS / "rocket.png").read_bytes()), "image/png"))],
        )
    ).json()[0]["digest"]


async def hoodie_in_winter(client) -> tuple[int, int]:
    """Цветомодель B-HDY-14 и id «Зимы» — в матрице несколько цветов одной модели."""
    winter = next(d for d in (await client.get(f"{API}/drops")).json() if d["name"] == "Зима 2026/27")
    matrix = (await client.get(f"{API}/drops/{winter['id']}/matrix")).json()
    row = next(r for r in matrix["rows"] if r["model"]["code"] == "B-HDY-14")
    assert len(row["cells"]) >= 2, "в Зиме у худи должно быть ≥2 цветов"
    return next(iter(row["cells"].values()))["colour_model_id"], winter["id"]


@pytest.mark.asyncio
async def test_new_reference_is_family_of_model_colours_in_drop(client) -> None:
    """Новый референс на цветомодели — сразу на всех цветах модели в дропе."""
    cm_id, drop_id = await hoodie_in_winter(client)
    d = await digest(client)
    r = await client.post(
        f"{API}/references",
        headers=as_(IVANOVA),
        json={
            "name": "мишка",
            "sheet_digest": d,
            "image_digests": [d],
            "texts": [],
            "colour_model_id": cm_id,
            "drop_id": drop_id,
        },
    )
    assert r.status_code == 200, r.text
    ref = r.json()["id"]

    family = (await client.get(f"{API}/references/{ref}/family")).json()
    assert len(family) >= 2, "семья шире одного цвета"
    assert all(c["in_family"] for c in family)

    other = next(c for c in family if c["colour_model_id"] != cm_id)
    assert (await client.post(f"{API}/references/{ref}/family/{other['colour_model_id']}/exclude")).status_code == 204
    after = {c["colour_model_id"]: c["in_family"] for c in (await client.get(f"{API}/references/{ref}/family")).json()}
    assert after[other["colour_model_id"]] is False
    assert after[cm_id] is True

    assert (await client.post(f"{API}/references/{ref}/family/{cm_id}/exclude")).status_code == 422
    assert (await client.post(f"{API}/references/{ref}/family/{other['colour_model_id']}/include")).status_code == 204
    assert all(c["in_family"] for c in (await client.get(f"{API}/references/{ref}/family")).json())

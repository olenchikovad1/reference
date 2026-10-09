"""Каталог PLM live: связь со своими кадрами, без зеркала справочников (US-0886)."""

from __future__ import annotations

import json

import httpx
import pytest

from reference_api.db import engine, session_factory
from reference_api.repositories import plm_links as links_repo
from reference_api.services import plm as plm_service


@pytest.fixture(autouse=True)
async def _fresh_db_pool():
    """Свой цикл на тест: пул asyncpg от прошлого цикла не переиспользуем."""
    yield
    await engine.dispose()


def _plm_transport(colorways: list[dict]) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/api/machine/colorways"):
            return httpx.Response(200, content=json.dumps({"items": colorways}).encode())
        if request.url.path.endswith("/api/machine/drops"):
            return httpx.Response(200, content=json.dumps({"items": [{"code": "AW26", "active": True}]}).encode())
        return httpx.Response(404)

    return httpx.MockTransport(handler)


@pytest.mark.asyncio
async def test_style_link_resolves_product_and_workability() -> None:
    """Тонкая связь style → кадры: без неё работу начать нельзя, с ней — можно."""
    async with session_factory() as db:
        await links_repo.upsert(db, style_code="2027", product_code="B-HDY-14")
        await db.commit()
        linked = await links_repo.product_code(db, "2027")
        assert linked == "B-HDY-14"
        missing = await links_repo.product_code(db, "NO-SUCH")
        assert missing is None


@pytest.mark.asyncio
async def test_colorways_carry_swatch_and_can_work() -> None:
    """Список ЦМ из plm обогащается плашкой и can_work по своей связи, не копией каталога."""
    rows = [
        {
            "id": "cw-1",
            "article": "2027-BLK",
            "title": "Худи чёрная",
            "style_id": "s1",
            "style_code": "2027",
            "color": "Black",
            "rgb": [20, 20, 20],
        },
        {
            "id": "cw-2",
            "article": "9999-RED",
            "title": "Без кадров",
            "style_id": "s2",
            "style_code": "9999",
            "color": "Red",
            "rgb": [200, 0, 0],
        },
    ]
    transport = _plm_transport(rows)

    async with session_factory() as db:
        await links_repo.upsert(db, style_code="2027", product_code="B-HDY-14")
        await db.commit()

    items = await plm_service.list_colorways(
        "http://plm.test/plm", "secret", drop="AW26", transport=transport
    )
    async with session_factory() as db:
        enriched = await plm_service.enrich_colorways(db, items)

    by_id = {c["id"]: c for c in enriched}
    assert by_id["cw-1"]["rgb"] == [20, 20, 20]
    assert by_id["cw-1"]["can_work"] is True
    assert by_id["cw-1"]["product_code"] == "B-HDY-14"
    assert by_id["cw-2"]["can_work"] is False
    assert by_id["cw-2"]["reason"]
    assert "кадр" in by_id["cw-2"]["reason"].lower()

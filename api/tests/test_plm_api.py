"""HTTP-контракт каталога PLM (US-0883)."""

from __future__ import annotations

import httpx
import pytest_asyncio

from reference_api.app import create_app


@pytest_asyncio.fixture
async def client():
    app = create_app()
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
        ) as http:
            yield http


async def test_status_when_plm_unset(client) -> None:
    response = await client.get("/reference/api/plm/status")
    assert response.status_code == 200
    body = response.json()
    assert body["configured"] is False
    assert body["reachable"] is False


async def test_drops_when_unset_are_service_unavailable(client) -> None:
    response = await client.get("/reference/api/plm/drops")
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "plm_unset"

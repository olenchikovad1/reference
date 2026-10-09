"""Клиент чтения PLM (US-0883): таймаут, ключ, понятный отказ."""

from __future__ import annotations

import json

import httpx
import pytest

from reference_api.services import plm


def _transport(status: int, body: dict | list | None = None, *, capture: dict | None = None) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if capture is not None:
            capture["auth"] = request.headers.get("authorization")
            capture["url"] = str(request.url)
            capture["path"] = request.url.path
        content = b"" if body is None else json.dumps(body).encode()
        return httpx.Response(status, content=content)

    return httpx.MockTransport(handler)


@pytest.mark.asyncio
async def test_drops_go_with_machine_key_to_plm_machine_entrance() -> None:
    seen: dict = {}
    t = _transport(200, {"items": [{"code": "AW26", "season": "AW26", "active": True}]}, capture=seen)
    items = await plm.list_drops(
        "http://plm.example/plm",
        "ref_machine_secret",
        transport=t,
    )
    assert seen["auth"] == "Bearer ref_machine_secret"
    assert seen["path"].endswith("/api/machine/drops")
    assert items[0].code == "AW26"


@pytest.mark.asyncio
async def test_plm_unreachable_is_named_failure_not_hang() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down", request=request)

    with pytest.raises(plm.PlmUnavailable) as caught:
        await plm.list_drops("http://plm.example/plm", "k", transport=httpx.MockTransport(handler))
    assert "недоступен" in str(caught.value).lower() or "plm" in str(caught.value).lower()


@pytest.mark.asyncio
async def test_wrong_key_is_refusal_not_retry_storm() -> None:
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(401, content=b'{"detail":"no"}')

    with pytest.raises(plm.PlmRefused):
        await plm.list_drops("http://plm.example/plm", "bad", transport=httpx.MockTransport(handler))
    assert calls["n"] == 1

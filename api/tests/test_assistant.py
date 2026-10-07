"""Инструменты «Референса» для ИИ-помощника (план 119, US-0896).

Помощник ходит правами своего человека (решение платформы 0034): что человеку
нельзя, того помощнику нет ни в списке, ни при вызове — отказ неотличим от
несуществующего инструмента (З-27). Протокол и проверка права — общая
библиотека платформы (решение 0035); здесь — что «Референс» отдаёт.
"""

import json

import httpx
import pytest_asyncio
from sqlalchemy import text

from reference_api.app import create_app
from tests.test_rights import FixedKeys, bearer

MCP = "/reference/api/mcp"
EVERYTHING = ("references:view", "references:write", "drops:view", "prints:view", "review:view")


@pytest_asyncio.fixture
async def client():
    from reference_api.db import engine

    app = create_app(without_platform=False)
    app.state.keys = FixedKeys()
    async with app.router.lifespan_context(app):
        async with engine.begin() as conn:
            await conn.execute(text("truncate table reference_cards cascade"))
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://stand") as c:
            yield c
    await engine.dispose()


async def rpc(client, method: str, params: dict | None = None, *grants: str) -> dict:
    r = await client.post(MCP, headers=bearer(*grants),
                          json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}})
    assert r.status_code == 200, r.text
    return r.json()


async def tool_names(client, *grants: str) -> set[str]:
    return {t["name"] for t in (await rpc(client, "tools/list", None, *grants))["result"]["tools"]}


async def test_the_list_holds_only_what_the_person_may(client) -> None:
    everything = await tool_names(client, *EVERYTHING)
    assert {"references", "reference", "drops", "drop_assortment", "drop_board"} <= everything
    only_references = await tool_names(client, "references:view")
    assert "references" in only_references
    assert "drops" not in only_references and "drop_board" not in only_references, "без права на дропы их нет"


async def test_a_tool_without_the_right_answers_like_a_missing_one(client) -> None:
    refused = await rpc(client, "tools/call", {"name": "drops", "arguments": {}}, "references:view")
    missing = await rpc(client, "tools/call", {"name": "no_such_tool", "arguments": {}}, "references:view")
    assert refused["error"]["code"] == missing["error"]["code"]


async def test_references_are_what_the_showcase_shows(client) -> None:
    saved = await client.post("/reference/api/references", headers=bearer(*EVERYTHING), json={
        "name": "мишка на красном", "sheet_digest": "a" * 64, "image_digests": [], "texts": []})
    assert saved.status_code == 200, saved.text
    ref = saved.json()["id"]
    found = await rpc(client, "tools/call", {"name": "references", "arguments": {}}, *EVERYTHING)
    rows = json.loads(found["result"]["content"][0]["text"])
    assert [(r["id"], r["name"], r["status"]) for r in rows] == [(ref, "мишка на красном", "draft")]

    opened = await rpc(client, "tools/call", {"name": "reference", "arguments": {"id": ref}}, *EVERYTHING)
    card = json.loads(opened["result"]["content"][0]["text"])
    assert (card["id"], card["status"], card["versions"]) == (ref, "draft", 1)

    nobody = await rpc(client, "tools/call", {"name": "reference", "arguments": {"id": ref + 999}}, *EVERYTHING)
    assert nobody["result"]["isError"] and "нет" in nobody["result"]["content"][0]["text"]


async def test_without_a_token_there_is_no_entrance(client) -> None:
    r = await client.post(MCP, json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    assert r.status_code == 404

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


# --- Согласование словами (US-0897) -----------------------------------------

REVIEWER = (*EVERYTHING, "review:write", "dictionaries:write")


def bot_bearer(*grants: str) -> dict[str, str]:
    """Токен человека, выданный боту: страж меняет ключ бота на такой токен
    с пометкой (решение платформы 0034)."""
    import datetime

    import jwt

    from tests.test_rights import KEY

    now = datetime.datetime.now(datetime.UTC)
    claims = {"sub": "01SOMEONE", "aud": "reference", "exp": now + datetime.timedelta(minutes=5),
              "org": "01ORG", "vis": "own", "grants": list(grants),
              "act": "bot", "bot": "01BOT", "bot_name": "помощник Алексея"}
    return {"Authorization": "Bearer " + jwt.encode(claims, KEY, algorithm="RS256", headers={"kid": "t1"})}


async def bot_call(client, name: str, arguments: dict, *grants: str) -> dict:
    r = await client.post(MCP, headers=bot_bearer(*grants), json={
        "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": arguments}})
    assert r.status_code == 200, r.text
    return r.json()


async def chief_reference(client) -> int:
    """Референс и я — главный в согласовании: роль — своя таблица (решение 0016)."""
    r = await client.put("/reference/api/people/01SOMEONE", headers=bearer(*REVIEWER),
                         json={"full_name": "Оленчиков Алексей", "role": "chief"})
    assert r.status_code == 200, r.text
    saved = await client.post("/reference/api/references", headers=bearer(*REVIEWER), json={
        "name": "мишка", "sheet_digest": "a" * 64, "image_digests": [], "texts": []})
    return saved.json()["id"]


async def test_return_needs_a_reason_and_the_path_shows_the_bot(client) -> None:
    ref = await chief_reference(client)
    silent = await bot_call(client, "review_decision", {"id": ref, "action": "return"}, *REVIEWER)
    assert silent["result"]["isError"] and "замечани" in silent["result"]["content"][0]["text"], \
        "без причины — тот же отказ словами, что у кнопки"

    done = await bot_call(client, "review_decision",
                          {"id": ref, "action": "return", "comment": "мишка вылезает за молнию"}, *REVIEWER)
    assert not done["result"]["isError"], done
    card = (await client.get(f"/reference/api/references/{ref}", headers=bearer(*REVIEWER))).json()
    last = card["status_events"][-1]
    assert (card["status"], last["comment"], last["bot_name"]) == ("rework", "мишка вылезает за молнию",
                                                                    "помощник Алексея")


async def test_a_decision_needs_the_review_right(client) -> None:
    ref = await chief_reference(client)
    refused = await bot_call(client, "review_decision", {"id": ref, "action": "approve"}, *EVERYTHING)
    assert refused["error"]["code"] == -32602, "без права записи в согласовании инструмента нет"


async def test_remark_and_agenda(client) -> None:
    ref = await chief_reference(client)
    said = await bot_call(client, "remark", {"id": ref, "text": "поднять на 2 см"}, *REVIEWER)
    assert not said["result"]["isError"], said
    remarks = (await client.get(f"/reference/api/references/{ref}/remarks", headers=bearer(*REVIEWER))).json()
    assert [r["text"] for r in remarks] == ["поднять на 2 см"]
    proposed = await bot_call(client, "propose_for_discussion", {"id": ref, "reason": "сюжет спорный"}, *REVIEWER)
    assert not proposed["result"]["isError"], proposed

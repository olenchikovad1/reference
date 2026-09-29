"""Статусы и чей ход (план 075, US-0510).

Статус — у карточки: черновик → на согласовании → на доработке → согласован
→ окончательно принят. Переходы — по роли в согласовании (решение 0016).
Чей ход — вычисляется из статуса и ролей, полем не хранится (И-8): «Мои
задачи» собираются вычислением. Работа двоих — через «я — …» стенда.
"""

import io
import pathlib

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import text

from reference_api.app import create_app
from reference_api.services import bell

PRINTS = pathlib.Path("/srv/reference/files/prints")
IVANOVA, PETROV, SIDOROVA, CHIEF = "stand-ivanova", "stand-petrov", "stand-sidorova", "stand-chief"
API = "/reference/api"


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
            for who, name, role in [(IVANOVA, "Иванова Мария", "designer"), (PETROV, "Петров Олег", "editor"),
                                    (SIDOROVA, "Сидорова Анна", "editor"), (CHIEF, "Главный Пётр", "chief")]:
                assert (await c.put(f"{API}/people/{who}", json={"full_name": name, "role": role})).status_code == 200
            yield c
    await engine.dispose()


async def digest(client) -> str:
    return (await client.post(f"{API}/assets", files=[
        ("files", ("rocket.png", io.BytesIO((PRINTS / "rocket.png").read_bytes()), "image/png"))])).json()[0]["digest"]


async def new_reference(client) -> int:
    d = await digest(client)
    r = await client.post(f"{API}/references", headers=as_(IVANOVA), json={
        "name": "ракета", "sheet_digest": d, "image_digests": [d], "texts": []})
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def save_version(client, ref: int) -> None:
    d = await digest(client)
    r = await client.post(f"{API}/references/{ref}/versions", headers=as_(IVANOVA), json={
        "name": "ракета левее", "sheet_digest": d, "image_digests": [d], "texts": []})
    assert r.status_code == 200, r.text


async def tasks(client, who: str) -> dict:
    r = await client.get(f"{API}/tasks", headers=as_(who))
    assert r.status_code == 200, r.text
    return r.json()


def ids(rows: list[dict]) -> list[int]:
    return [t["id"] for t in rows]


async def test_the_whole_path_with_turns_computed_from_status_and_roles(client) -> None:
    ref = await new_reference(client)
    assert (await client.get(f"{API}/references/{ref}")).json()["status"] == "draft"

    r = await client.post(f"{API}/references/{ref}/submit", headers=as_(IVANOVA))
    assert r.status_code == 200, r.text
    for editor in (PETROV, SIDOROVA):
        mine = (await tasks(client, editor))["mine"]
        assert ids(mine) == [ref] and mine[0]["reason"] == "на согласовании"
    waiting = (await tasks(client, IVANOVA))["waiting"]
    assert ids(waiting) == [ref] and waiting[0]["reason"] == "ждёт согласования"

    assert (await client.post(f"{API}/references/{ref}/return", headers=as_(PETROV), json={"comment": "  "})).status_code == 422
    r = await client.post(f"{API}/references/{ref}/return", headers=as_(PETROV), json={"comment": "ракету левее на 2 см"})
    assert r.status_code == 200, r.text
    mine = (await tasks(client, IVANOVA))["mine"]
    assert ids(mine) == [ref] and mine[0]["reason"] == "вернули: «ракету левее на 2 см»"
    assert (await tasks(client, SIDOROVA))["mine"] == [], "у второго редактора задача не пропала"

    await save_version(client, ref)
    assert (await client.post(f"{API}/references/{ref}/submit", headers=as_(IVANOVA))).status_code == 200
    assert (await client.post(f"{API}/references/{ref}/approve", headers=as_(SIDOROVA))).status_code == 200
    assert ids((await tasks(client, CHIEF))["mine"]) == [ref]
    assert (await tasks(client, PETROV))["mine"] == []
    assert (await client.post(f"{API}/references/{ref}/approve-final", headers=as_(CHIEF))).status_code == 200

    card = (await client.get(f"{API}/references/{ref}")).json()
    assert card["status"] == "final"
    path = [(e["to"], e["number"], e["by_name"]) for e in card["status_events"]]
    assert path == [("review", 1, "Иванова Мария"), ("rework", 1, "Петров Олег"), ("review", 2, "Иванова Мария"),
                    ("approved", 2, "Сидорова Анна"), ("final", 2, "Главный Пётр")]
    for who in (IVANOVA, PETROV, SIDOROVA, CHIEF):
        assert (await tasks(client, who))["mine"] == []


async def test_a_step_not_of_your_role_is_refused(client) -> None:
    ref = await new_reference(client)
    assert (await client.post(f"{API}/references/{ref}/submit", headers=as_(PETROV))).status_code == 403
    await client.post(f"{API}/references/{ref}/submit", headers=as_(IVANOVA))
    assert (await client.post(f"{API}/references/{ref}/approve", headers=as_(IVANOVA))).status_code == 403
    assert (await client.post(f"{API}/references/{ref}/approve-final", headers=as_(PETROV))).status_code == 403,         "окончательно — только главный"
    card = (await client.get(f"{API}/references/{ref}", headers=as_(IVANOVA))).json()
    assert card["status"] == "review" and card["can"] == ["recall"], "принять ей нельзя, отозвать — можно"


async def test_editing_an_approved_reference_sends_it_back_to_draft(client) -> None:
    ref = await new_reference(client)
    await client.post(f"{API}/references/{ref}/submit", headers=as_(IVANOVA))
    await client.post(f"{API}/references/{ref}/approve", headers=as_(PETROV))
    await save_version(client, ref)
    card = (await client.get(f"{API}/references/{ref}")).json()
    assert card["status"] == "draft"
    assert card["status_events"][-1]["to"] == "draft" and card["status_events"][-1]["number"] == 2


# --- Колокол платформы (US-0513) -------------------------------------------
# Звонок подменён: что ушло бы в сервис уведомлений, собирается в список.
@pytest.fixture
def rung(monkeypatch) -> list[dict]:
    got: list[dict] = []

    async def deliver(payload: dict) -> None:
        got.append(payload)

    monkeypatch.setattr(bell, "deliver", deliver)
    return got


async def step(client, ref: int, what: str, who: str, **body) -> None:
    r = await client.post(f"{API}/references/{ref}/{what}", headers=as_(who), json=body or None)
    assert r.status_code == 200, r.text
    await bell.drain()


async def test_submit_rings_editors_and_return_rings_the_executor(client, rung) -> None:
    ref = await new_reference(client)
    await save_version(client, ref)
    await bell.drain()
    assert rung == [], "сохранение без смены статуса не звонит"

    await step(client, ref, "submit", IVANOVA)
    [sent] = rung
    assert sent["recipients"] == sorted([PETROV, SIDOROVA, CHIEF]), "всем редакторам и главному, не себе"
    assert sent["subject"] == f"Референс №{ref} ждёт согласования"
    assert (sent["link"], sent["occasion"]) == (f"/reference/references/{ref}", f"reference:{ref}:review:v2")

    await step(client, ref, "return", PETROV, comment="ракету левее на 2 см")
    back = rung[1]
    assert back["recipients"] == [IVANOVA], "вернули — исполнителю"
    assert (back["subject"], back["body"]) == (f"Референс №{ref} вернули на доработку", "ракету левее на 2 см")

    await step(client, ref, "submit", IVANOVA)
    await step(client, ref, "approve", SIDOROVA)
    assert len(rung) == 3, "принятие не звонит: ход ушёл главному, «Мои задачи» это покажут"


# --- Новые переходы (план 094) --------------------------------------------


async def test_recall_unapprove_reject_and_revive_follow_the_table(client) -> None:
    ref = await new_reference(client)
    post = lambda what, who, **body: client.post(f"{API}/references/{ref}/{what}", headers=as_(who), json=body or None)  # noqa: E731
    status = lambda: client.get(f"{API}/references/{ref}")  # noqa: E731

    assert (await post("submit", IVANOVA)).status_code == 200
    assert (await post("recall", PETROV)).status_code == 403, "отзывает исполнитель"
    assert (await post("recall", IVANOVA)).status_code == 200
    assert (await status()).json()["status"] == "draft", "отозвала — снова черновик"

    await post("submit", IVANOVA)
    await post("approve", PETROV)
    assert (await post("unapprove", PETROV, comment="")).status_code == 422, "отменить — только с причиной"
    assert (await post("unapprove", PETROV, comment="согласовал не ту")).status_code == 200
    assert (await status()).json()["status"] == "review"

    r = await post("reject", SIDOROVA, comment=" ")
    assert r.status_code == 422 and "причин" in r.json()["detail"]
    assert (await post("reject", SIDOROVA, comment="сюжет не для детей")).status_code == 200
    card = (await status()).json()
    assert card["status"] == "rejected"

    d = await digest(client)
    r = await client.post(f"{API}/references/{ref}/versions", headers=as_(IVANOVA), json={
        "name": "ракета", "sheet_digest": d, "image_digests": [d], "texts": []})
    assert r.status_code == 409 and "забракован" in r.json()["detail"], "забракованный не правится"
    assert (await post("submit", IVANOVA)).status_code == 409

    assert (await post("revive", SIDOROVA, comment="давай ещё раз")).status_code == 403, "вернуть — только главный"
    assert (await post("revive", CHIEF, comment="переделаем сюжет")).status_code == 200
    events = (await status()).json()["status_events"]
    assert [e["to"] for e in events][-2:] == ["rejected", "draft"]
    assert events[-2]["comment"] == "сюжет не для детей" and events[-1]["comment"] == "переделаем сюжет"


async def test_liked_draft_is_decided_at_once(client) -> None:
    """План 095: понравилось как есть — согласовать или принять сразу."""
    ref = await new_reference(client)
    can = (await client.get(f"{API}/references/{ref}", headers=as_(CHIEF))).json()["can"]
    assert {"approve", "approve-final", "reject"} <= set(can), "у черновика главному решать можно сразу"
    r = await client.post(f"{API}/references/{ref}/approve-final", headers=as_(CHIEF))
    assert r.status_code == 200
    assert (await client.get(f"{API}/references/{ref}")).json()["status"] == "final"


async def test_approved_waits_for_the_chief_only_with_the_final_right(client) -> None:
    """План 097: у главного без права «Окончательное принятие» согласованное
    не лежит в «Ждёт меня» — шаг ему не доступен."""
    from reference_api.db import session_factory
    from reference_api.services import review

    ref = await new_reference(client)
    await client.post(f"{API}/references/{ref}/approve", headers=as_(CHIEF))
    async with session_factory() as db:
        with_right, _ = await review.tasks(db, CHIEF, can_final=True)
        without, _ = await review.tasks(db, CHIEF, can_final=False)
    assert ref in [t.id for t in with_right]
    assert ref not in [t.id for t in without]

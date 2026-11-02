"""Порционное чтение проверяется в тестовой БД, все изменения откатываются."""
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import event, text

from reference_api.app import create_app
from reference_api.db import engine, session, session_factory
from reference_api.models.references import Reference, ReferenceDraft, ReferencePosition, ReferenceVersion
from reference_api.models.drops import ColourModel, Drop, DropItem, GarmentModel, HierarchyNode
from reference_api.models.people import AppPerson
from reference_api.services import references as service


@pytest_asyncio.fixture
async def catalogue():
    assert engine.url.database.endswith("_test"), "проверка разрешена только в тестовой БД"
    # PUT фиксирует свою транзакцию: внешний rollback сохраняет тестовую БД
    # даже при настоящем commit сервиса, а не при подмене commit заглушкой.
    async with engine.connect() as connection:
        transaction = await connection.begin()
        try:
            async with session_factory(bind=connection, join_transaction_mode="create_savepoint") as db:
                await db.execute(text("truncate table reference_cards cascade"))
                cards = [Reference(name=f"Page {i}", status="draft", executor_id="page-owner" if i % 2 else None)
                         for i in range(185)]
                db.add_all(cards)
                await db.flush()
                instant = datetime(2026, 1, 1, tzinfo=timezone.utc)
                db.add_all([ReferenceVersion(reference_id=c.id, number=1, sheet_digest="a" * 64,
                                            created_at=instant, image_digests=[], views={}, work={"payload": "x" * 1000})
                            for c in cards])
                await db.flush()
                app = create_app(without_platform=True)

                async def test_session():
                    yield db

                app.dependency_overrides[session] = test_session
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test",
                                            headers={"X-Stand-As": "page-owner"}) as client:
                    yield db, client, cards
        finally:
            await transaction.rollback()
    await engine.dispose()


async def page(client, **params):
    response = await client.get("/reference/api/references/page", params=params)
    assert response.status_code == 200, response.text
    return response.json()


async def test_page_is_bounded_but_legacy_list_is_complete(catalogue):
    _, client, cards = catalogue
    statements = []

    def record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", record)
    try:
        first = await page(client)
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", record)
    assert len(first["items"]) == 60
    assert first["total"] == len(cards)
    assert first["next_cursor"]
    assert not any("reference_versions.work" in sql for sql in statements)
    assert len((await client.get("/reference/api/references")).json()) == len(cards)


async def test_reject_and_revive_availability_follows_role_and_status(catalogue):
    db, client, cards = catalogue
    person = await db.get(AppPerson, "page-owner")
    if person is None:
        person = AppPerson(subject_id="page-owner", full_name="Page owner", role="chief")
        db.add(person)
    cards[-1].status, cards[-2].status = "final", "rejected"
    for role in ("chief", "editor", "designer"):
        person.role = role
        await db.flush()
        result = await page(client)
        shown = {item["id"]: item for item in result["items"]}
        assert shown[cards[-3].id].get("can_reject") is (role in {"chief", "editor"})
        assert shown[cards[-1].id].get("can_reject") is False
        rejected = (await client.get("/reference/api/references/rejected")).json()
        row = next(item for item in rejected if item["id"] == cards[-2].id)
        assert row.get("can_revive") is (role == "chief")


async def test_equal_dates_and_insertion_or_deletion_do_not_shift_pages(catalogue):
    db, client, cards = catalogue
    first = await page(client, limit=23)
    seen = [c["id"] for c in first["items"]]
    # Удаление перед курсором сдвинуло бы offset, но не ключ сортировки.
    cards[-1].deleted_at = datetime.now(timezone.utc)
    newer = Reference(name="new after first page")
    db.add(newer)
    await db.flush()
    db.add(ReferenceVersion(reference_id=newer.id, number=1, sheet_digest="b" * 64,
                            image_digests=[], created_at=datetime.now(timezone.utc)))
    await db.flush()
    cursor = first["next_cursor"]
    while cursor:
        result = await page(client, limit=23, cursor=cursor)
        seen.extend(c["id"] for c in result["items"])
        cursor = result["next_cursor"]
    assert len(seen) == len(set(seen)) == len(cards)
    assert set(seen) == {c.id for c in cards}
    assert newer.id not in seen


async def test_filters_apply_before_limit_and_cursor_is_bound_to_view(catalogue):
    db, client, cards = catalogue
    # Искомая карточка в самом конце даты, за первыми порциями.
    cards[0].status = "final"
    cards[0].executor_id = "page-owner"
    db.add(ReferenceDraft(reference_id=cards[0].id, author_id="page-owner", base_number=1, work={}))
    await db.flush()
    found = await page(client, status="final", only_mine=True, only_drafts=True)
    assert [c["id"] for c in found["items"]] == [cards[0].id]
    assert found["total"] == 1 and found["next_cursor"] is None
    first = await page(client, limit=10)
    wrong = await client.get("/reference/api/references/page", params={"cursor": first["next_cursor"], "status": "draft"})
    assert wrong.status_code == 422
    assert wrong.json()["detail"]["code"] == "invalid_cursor"
    other = await client.get("/reference/api/references/page", params={"cursor": first["next_cursor"]},
                             headers={"X-Stand-As": "someone-else"})
    assert other.status_code == 422
    bad = await client.get("/reference/api/references/page", params={"cursor": "not-json"})
    assert bad.status_code == 422


async def test_own_order_and_compact_navigation_include_unloaded_cards(catalogue):
    db, client, cards = catalogue
    db.add_all([ReferencePosition(author_id="page-owner", reference_id=c.id, position=i)
                for i, c in enumerate(cards)])
    await db.flush()
    first = await page(client, sort="own", limit=5)
    assert [c["id"] for c in first["items"]] == [c.id for c in cards[:5]]
    second = await page(client, sort="own", limit=5, cursor=first["next_cursor"])
    assert [c["id"] for c in second["items"]] == [c.id for c in cards[5:10]]
    response = await client.get("/reference/api/references/order", params={"sort": "own"})
    assert response.status_code == 200, response.text
    assert response.json() == [c.id for c in cards]


async def test_empty_and_limit_validation(catalogue):
    _, client, _ = catalogue
    empty = await page(client, status="final")
    assert empty == {"items": [], "total": 0, "next_cursor": None}
    for limit in (0, 121):
        assert (await client.get("/reference/api/references/page", params={"limit": limit})).status_code == 422
    assert len((await page(client, q="   "))["items"]) == 60


async def seed_places(db, cards):
    root = HierarchyNode(level="direction", name="Page " + uuid4().hex)
    db.add(root)
    await db.flush()
    colours = []
    for audience in ("boys", "girls", "all"):
        gender = HierarchyNode(level="gender", name=audience, audience=audience, parent_id=root.id)
        db.add(gender)
        await db.flush()
        category = HierarchyNode(level="category", name="Футболка" if audience == "girls" else "Худи", parent_id=gender.id)
        db.add(category)
        await db.flush()
        model = GarmentModel(code="PAGE-" + uuid4().hex, name="Page", category_id=category.id)
        db.add(model)
        await db.flush()
        cm = ColourModel(model_id=model.id, colour_code="WHITE")
        db.add(cm)
        await db.flush()
        colours.append(cm)
    day = date.today()
    windows = [(day - timedelta(days=20), day + timedelta(days=60)),
               (day - timedelta(days=90), day - timedelta(days=20)),
               (day - timedelta(days=20), day + timedelta(days=3))]
    drops = []
    for card, cm, (start, end) in zip(cards[:3], colours, windows, strict=True):
        item = Drop(name="PAGE " + uuid4().hex, season="test", audience="test", release_from=start, release_to=end)
        db.add(item)
        await db.flush()
        db.add(DropItem(drop_id=item.id, colour_model_id=cm.id))
        card.colour_model_id = cm.id
        drops.append(item)
    await db.flush()
    return drops


async def test_drop_category_audience_and_season_are_global(catalogue, monkeypatch):
    db, client, cards = catalogue
    drops = await seed_places(db, cards)
    monkeypatch.setattr(service, "settings", lambda: SimpleNamespace(plm_base_url="", plm_machine_key=""))
    for params, expected in [({"drop": drops[0].id}, [cards[0].id]),
                             ({"category": "Худи", "audience": "boys"}, [cards[2].id, cards[0].id]),
                             ({"audience": "all"}, [cards[2].id]),
                             ({"season": "out"}, [cards[1].id]),
                             ({"season": "ending"}, [cards[2].id])]:
        result = await page(client, **params)
        assert [c["id"] for c in result["items"]] == expected
    # Неизвестное окно остаётся в сезоне, а не исчезает из выдачи.
    result = await page(client, season="in", limit=120)
    assert result["total"] == len(cards) - 1


async def test_my_turn_uses_role_and_executor(catalogue):
    db, client, cards = catalogue
    person = await db.get(AppPerson, "page-owner")
    if person is None:
        person = AppPerson(subject_id="page-owner", full_name="Page owner", role="designer")
        db.add(person)
    cards[0].status, cards[0].executor_id = "rework", "page-owner"
    cards[1].status, cards[1].executor_id = "rework", "someone-else"
    cards[2].status = "review"
    cards[3].status = "approved"
    await db.flush()
    assert [c["id"] for c in (await page(client, my_turn=True))["items"]] == [cards[0].id]
    person.role = "editor"
    await db.flush()
    assert [c["id"] for c in (await page(client, my_turn=True))["items"]] == [cards[2].id, cards[0].id]
    person.role = "chief"
    await db.flush()
    assert [c["id"] for c in (await page(client, my_turn=True))["items"]] == [cards[3].id, cards[2].id, cards[0].id]
    restricted = await service.page(db, service.PageFilters(my_turn=True), "page-owner", can_review=True, can_final=False)
    assert [c.id for c, _ in restricted.rows] == [cards[2].id, cards[0].id]
    denied = await service.page(db, service.PageFilters(my_turn=True), "page-owner", can_review=False)
    assert denied.total == 0


async def test_plm_window_overrides_local_fixture_dates(catalogue, monkeypatch):
    from reference_api.services import plm

    db, client, cards = catalogue
    drops = await seed_places(db, cards)
    monkeypatch.setattr(service, "settings", lambda: SimpleNamespace(plm_base_url="https://test/plm", plm_machine_key="app"))
    week = date.today().isocalendar().week
    # Местный дроп уже вне окна, PLM подтверждает актуальную неделю.
    live = plm.Drop(code="PLM-CURRENT", season=None, subseason=None, category=None,
                    description=drops[1].name, ship_week_uz=None, ship_week_cn=None,
                    intake_week=week, exit_week=week, active=True, position=0)

    async def directory(*args, **kwargs):
        return [live]

    monkeypatch.setattr(plm, "list_drops", directory)
    assert (await page(client, season="out"))["total"] == 0
    ending = await page(client, season="ending")
    assert {c["id"] for c in ending["items"]} == {cards[1].id, cards[2].id}


async def test_search_scores_and_reasons_are_paged_once(catalogue, monkeypatch):
    _, client, cards = catalogue
    calls = 0

    async def found(db, query):
        nonlocal calls
        calls += 1
        return [service.FoundReference(cards[0].id, "far", "slogan", 100, reasons=("точная надпись",)),
                service.FoundReference(cards[-1].id, "near", "tag", 2, reasons=("тег",))]

    monkeypatch.setattr(service, "find", found)
    first = await page(client, q="needle", limit=1, sort="own")
    assert calls == 1
    assert first["items"][0]["id"] == cards[0].id
    assert first["items"][0]["reasons"] == ["точная надпись"]
    second = await page(client, q="needle", limit=1, sort="own", cursor=first["next_cursor"])
    assert second["items"][0]["id"] == cards[-1].id
    assert second["next_cursor"] is None


@pytest.mark.parametrize("size", [5000])
async def test_large_catalogue_reads_only_a_bounded_page(catalogue, size):
    db, client, cards = catalogue
    extra = [Reference(name=f"Scale {i}") for i in range(size - len(cards))]
    db.add_all(extra)
    await db.flush()
    db.add_all([ReferenceVersion(reference_id=c.id, number=1, sheet_digest="c" * 64,
                                image_digests=[], work={"payload": "x" * 1000}) for c in extra])
    await db.flush()
    result = await page(client, limit=60)
    assert len(result["items"]) == 60 and result["total"] == size
    assert result["next_cursor"]


@pytest.mark.parametrize("size", [5000, 33000])
async def test_real_http_saves_and_restores_large_order(catalogue, size):
    db, client, cards = catalogue
    extra = [Reference(name=f"Order {i}") for i in range(size - len(cards))]
    db.add_all(extra)
    await db.flush()
    db.add_all([ReferenceVersion(reference_id=c.id, number=1, sheet_digest="d" * 64, image_digests=[], work={})
                for c in extra])
    await db.flush()
    original = (await client.get("/reference/api/references/order?sort=own")).json()
    assert len(original) == size
    moved = original[1:] + original[:1]
    for order in (moved, original, original):
        response = await client.put("/reference/api/references/order", json={"ids": order})
        assert response.status_code == 204, response.text[:1000]
        assert (await client.get("/reference/api/references/order?sort=own")).json() == order
        first = await page(client, sort="own")
        assert [item["id"] for item in first["items"]] == order[:60]
        assert first["total"] == size
    # Повтор допустим, а неверный порядок не должен затереть сохранённый.
    response = await client.put("/reference/api/references/order", json={"ids": original + original[:1]})
    assert response.status_code == 422
    assert (await client.get("/reference/api/references/order?sort=own")).json() == original
    if size == 5000:
        response = await client.put("/reference/api/references/order", json={"ids": list(range(1, 100002))})
        assert response.status_code == 422
        assert response.json()["detail"][0]["type"] == "too_long"
        assert (await client.get("/reference/api/references/order?sort=own")).json() == original

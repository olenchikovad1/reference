"""Страница текстов (US-0496): надписи из референсов и заведённые заранее,
поиск по словам — дословно, по всем словам, похожее с отметкой."""

import httpx
import pytest_asyncio

from reference_api.app import create_app


@pytest_asyncio.fixture
async def client():
    from sqlalchemy import text

    from reference_api.db import engine

    app = create_app()
    async with app.router.lifespan_context(app):
        async with engine.begin() as conn:
            await conn.execute(text("truncate table reference_cards, reference_versions, library_texts cascade"))
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://stand") as c:
            yield c
    await engine.dispose()


def work(text: str, font: str) -> dict:
    return {"version": 2, "stateCode": "back", "colourCode": "BLACK", "composition": {"selectedId": None, "elements": [
        {"id": "t1", "kind": "text", "name": "надпись", "text": text, "fontFamily": font, "weight": 600,
         "colourCode": "WHITE", "rgb": [255, 255, 255], "textAspect": 4,
         "placement": {"side": "back", "anchor": "neck", "dxCm": 0, "dyCm": 12, "widthCm": 18, "rotation": 0}}]}}


async def save(client, text: str, font: str) -> int:
    r = await client.post("/reference/api/references", json={
        "name": text, "sheet_digest": "c" * 64, "image_digests": [], "texts": [text], "work": work(text, font)})
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def rows(client, q: str | None = None) -> list[dict]:
    r = await client.get("/reference/api/library/texts", params={"q": q} if q else None)
    assert r.status_code == 200, r.text
    return r.json()


async def test_texts_come_from_references_with_fonts_and_count(client) -> None:
    a = await save(client, "ЛЕТО 2025", "Oswald")
    b = await save(client, "Лето 2025", "Inter")
    await save(client, "ЛЕТО 2024", "Oswald")
    row = next(r for r in await rows(client) if r["text"].upper() == "ЛЕТО 2025")
    assert sorted(c["id"] for c in row["references"]) == [a, b]
    assert row["fonts"] == ["Inter", "Oswald"], "шрифты надписи не собрались из работ"


async def test_search_marks_exact_words_and_close(client) -> None:
    await save(client, "ЛЕТО 2025", "Oswald")
    await save(client, "ЛЕТО 2024", "Oswald")
    await save(client, "ЗИМА", "Oswald")
    found = await rows(client, "лето 2025")
    assert [(r["text"], r["match"]) for r in found][:2] == [("ЛЕТО 2025", "same"), ("ЛЕТО 2024", "close")]
    assert "ЗИМА" not in [r["text"] for r in found]
    by_word = await rows(client, "лето")
    assert {r["text"]: r["match"] for r in by_word} == {"ЛЕТО 2025": "words", "ЛЕТО 2024": "words"}


async def test_slogan_planned_before_any_reference(client) -> None:
    r = await client.post("/reference/api/library/texts", json={"text": "С НОВЫМ 2027"})
    assert r.status_code == 204
    row = next(r for r in await rows(client) if r["text"] == "С НОВЫМ 2027")
    assert row["planned"] and row["references"] == []


async def test_trashed_reference_texts_are_not_listed(client) -> None:
    ref = await save(client, "ТОЛЬКО В КОРЗИНЕ", "Oswald")
    await client.post(f"/reference/api/references/{ref}/trash")
    assert "ТОЛЬКО В КОРЗИНЕ" not in [r["text"] for r in await rows(client)]

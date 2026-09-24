"""Автотеги: двадцать слов словаря языка по весам, сильных до десяти (US-0482).

Проверяется на настоящих принтах владельца, а не на нарисованных квадратах:
теги — это то, что модель видит на картинке, и квадрат ей показать нечего.
Ожидания записаны в prints.yaml до замера. Слова — в словарной форме:
словарь пишет «вертолет», а не «вертолёт».
"""

import io
import pathlib

import httpx
import pytest_asyncio

from reference_api.app import create_app
from reference_api.services import tags as tagging

PRINTS = pathlib.Path("/srv/reference/files/prints")
FRAMES = pathlib.Path("/srv/reference/files/products/B-HDY-14/states")


@pytest_asyncio.fixture
async def client():
    from sqlalchemy import text

    from reference_api.db import engine

    app = create_app()
    async with app.router.lifespan_context(app):
        async with engine.begin() as conn:
            await conn.execute(text("truncate table asset_embeddings, asset_tags"))
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://stand"
        ) as c:
            yield c
    await engine.dispose()


async def upload(client, path: pathlib.Path) -> str:
    r = await client.post(
        "/reference/api/assets",
        files=[("files", (path.name, io.BytesIO(path.read_bytes()), "image/png"))],
    )
    assert r.status_code == 200, r.text
    return r.json()[0]["digest"]


async def tags_of(client, path: pathlib.Path) -> list[dict]:
    digest = await upload(client, path)
    rec = await client.post("/reference/api/assets/recognise", json=[digest])
    assert rec.status_code == 200, rec.text
    return rec.json()[0]["tags"]


def strong(tags: list[dict]) -> set[str]:
    return {t["name"] for t in tags if t["strong"]}


async def test_winter_tank_has_tank_among_strong(client) -> None:
    tags = await tags_of(client, PRINTS / "t72-winter-print.png")
    assert "танк" in strong(tags), tags


async def test_helicopter_is_a_helicopter_not_a_tank(client) -> None:
    """Вертолёт среди сильных, и первым идёт не танк: машина на снегу и
    вертолёт над лесом модель не путает."""
    tags = await tags_of(client, PRINTS / "mi8-cloud-sharp-clean-print.png")
    assert "вертолет" in strong(tags), tags
    assert tags[0]["name"] != "танк", tags


async def test_twenty_tags_by_weight_up_to_ten_strong(client) -> None:
    """Двадцать тегов по убыванию веса; сильные — голова списка, их от
    одного до десяти, и граница между ними и прочими проходит по весу."""
    tags = await tags_of(client, PRINTS / "is3-winter-print.png")
    assert len(tags) == tagging.TOP
    scores = [t["score"] for t in tags]
    assert scores == sorted(scores, reverse=True)
    flags = [t["strong"] for t in tags]
    n = sum(flags)
    assert 1 <= n <= tagging.STRONG_MAX
    assert flags == [True] * n + [False] * (len(tags) - n), flags


async def test_no_picture_gets_group_words(client) -> None:
    """Принадлежность людей к народу, вере или политической силе тегом не
    ставится ни на одну картинку. Без исключения на этом наборе такие слова
    всплывают 23 раза («славянин», «чеченец», «большевик»…)."""
    excluded = tagging.excluded()
    for path in [*sorted(PRINTS.glob("*.png")), FRAMES / "front.png", FRAMES / "back.png"]:
        names = {t["name"] for t in await tags_of(client, path)}
        assert not names & excluded, (path.name, sorted(names & excluded))


async def test_each_tag_has_weight_and_the_model(client) -> None:
    """Вес виден числом, модель записана: сменится модель, словарь или
    перечень исключённого — теги пересчитываются, а не смешиваются."""
    for t in await tags_of(client, PRINTS / "is3-winter-print.png"):
        assert 0 < t["score"] <= 1
        assert t["model"] == tagging.model_name()


async def test_stored_tags_are_returned_without_recounting(client, monkeypatch) -> None:
    """Теги лежат у файла: страница спрашивает их по имени файла, и модель
    второй раз не зовётся. Сильные считаются из сохранённых весов и совпадают
    с поставленными."""
    path = PRINTS / "t72-winter-print.png"
    first = await tags_of(client, path)
    digest = await upload(client, path)

    def must_not_recount(vector: list[float]) -> list[tagging.Tag]:
        raise AssertionError("сохранённые теги посчитаны заново")

    monkeypatch.setattr(tagging, "tag", must_not_recount)
    got = await client.post("/reference/api/assets/tags", json=[digest])
    assert got.status_code == 200, got.text
    key = lambda ts: [(t["name"], round(t["score"], 6), t["strong"]) for t in ts]  # noqa: E731
    assert key(got.json()[0]["tags"]) == key(first)


async def test_tags_of_the_old_dictionary_are_recounted(client) -> None:
    """Теги закрытого словаря («Снег» от прежней модели) не отдаются: у них
    другое имя модели, и файл получает теги заново по лежащему вектору."""
    from sqlalchemy import text

    from reference_api.db import engine

    path = PRINTS / "t72-winter-print.png"
    await tags_of(client, path)
    digest = await upload(client, path)
    async with engine.begin() as conn:
        await conn.execute(text("delete from asset_tags where digest = :d"), {"d": digest})
        await conn.execute(
            text(
                "insert into asset_tags (digest, model, code, name, score) "
                "values (:d, 'clip-vit-base-patch32/text/quantized', 'snow', 'Снег', 0.9)"
            ),
            {"d": digest},
        )
    got = (await client.post("/reference/api/assets/tags", json=[digest])).json()[0]["tags"]
    assert len(got) == tagging.TOP
    assert "Снег" not in {t["name"] for t in got}
    assert {t["model"] for t in got} == {tagging.model_name()}

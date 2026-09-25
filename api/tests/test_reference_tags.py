"""Свои теги рядом с автотегами, и свои важнее (US-0493).

На настоящем наборе стенда, как поиск по картинкам: вес картинки считается
относительно всей библиотеки, и на двух квадратах «свой тег выше снега,
найденного моделью» не проверить.
"""

from tests.test_search_api import stand  # noqa: F401 — оснастка: библиотека из набора стенда


async def reference(client, digest: str, name: str) -> int:
    r = await client.post("/reference/api/references", json={
        "name": name, "sheet_digest": digest, "image_digests": [digest], "texts": []})
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def find(client, q: str) -> list[dict]:
    r = await client.get("/reference/api/references/find", params={"q": q})
    assert r.status_code == 200, r.text
    return r.json()


async def test_own_tag_is_found_by_part_and_other_form(stand) -> None:  # noqa: F811
    client, digests = stand
    ref = await reference(client, digests["pizza.png"], "пицца")
    r = await client.post(f"/reference/api/references/{ref}/tags", json={"name": "Школьная линейка"})
    assert r.status_code == 200 and r.json()["own"] == ["Школьная линейка"]
    for q in ("школьн", "школьной линейки"):
        found = await find(client, q)
        assert found and found[0]["id"] == ref and found[0]["by"] == "tag", f"{q}: {found}"
    names = (await client.get("/reference/api/references/tag-names", params={"prefix": "шко"})).json()
    assert names == ["Школьная линейка"], "подсказка не предложила заведённый тег"


async def test_own_tag_outranks_what_the_model_found(stand) -> None:  # noqa: F811
    """Свой «снег» у пиццы выше, чем зимний танк, найденный моделью по «снег»."""
    client, digests = stand
    tank = await reference(client, digests["is3-winter-print.png"], "зимний танк")
    pizza = await reference(client, digests["pizza.png"], "пицца")
    await client.post(f"/reference/api/references/{pizza}/tags", json={"name": "снег"})
    found = [f["id"] for f in await find(client, "снег")]
    assert found[:2] == [pizza, tank], f"свой тег не первым: {found}"


async def test_hidden_autotag_stops_finding_the_reference(stand) -> None:  # noqa: F811
    """Скрытый автотег перестаёт находить референс. Запрос — имя самого
    автотега картинки, по которому референс находился до скрытия: какие слова
    модель находит на этой картинке, решает она, а не тест."""
    client, digests = stand
    digest = digests["is3-winter-print.png"]
    ref = await reference(client, digest, "TANK POWER")
    tags = (await client.post("/reference/api/assets/tags", json=[digest])).json()[0]["tags"]
    finding = [t for t in tags if t["strong"] and ref in [f["id"] for f in await find(client, t["name"])]]
    assert finding, f"ни один сильный автотег не находит референс: {[t['name'] for t in tags if t['strong']]}"
    tag = finding[0]
    r = await client.post(f"/reference/api/references/{ref}/hidden-tags", json={"code": tag["code"], "name": tag["name"]})
    assert r.status_code == 200 and r.json()["hidden"] == [{"code": tag["code"], "name": tag["name"]}]
    assert ref not in [f["id"] for f in await find(client, tag["name"])], "скрытый автотег всё ещё находит"
    opened = (await client.get(f"/reference/api/references/{ref}")).json()
    assert opened["tags"]["hidden"] == [{"code": tag["code"], "name": tag["name"]}]


async def test_same_tag_twice_is_one_tag_and_removal_works(stand) -> None:  # noqa: F811
    client, digests = stand
    ref = await reference(client, digests["pizza.png"], "пицца")
    await client.post(f"/reference/api/references/{ref}/tags", json={"name": "зима"})
    again = await client.post(f"/reference/api/references/{ref}/tags", json={"name": "  Зима "})
    assert again.json()["own"] == ["зима"]
    gone = await client.delete(f"/reference/api/references/{ref}/tags", params={"name": "ЗИМА"})
    assert gone.json()["own"] == []

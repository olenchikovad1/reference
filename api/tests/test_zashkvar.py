"""Зашквар (US-0499): удалить насовсем сразу — и забраковать картинку.

Брак живёт в базе между прогонами (оснастка набора его не чистит), поэтому
каждый тест снимает свой брак сам.
"""

import io

from fastapi.testclient import TestClient
from PIL import Image

from reference_api.app import create_app
from tests.test_rights import FixedKeys, bearer
from tests.test_search_api import PRINTS, stand  # noqa: F401 — оснастка: библиотека из набора стенда

HELI = "mi8-cloud-sharp-clean-print.png"


async def save(client, digest: str, name: str):
    return await client.post("/reference/api/references", json={
        "name": name, "sheet_digest": digest, "image_digests": [digest], "texts": [], "views": {"front": digest}})


async def test_erase_forever_leaves_nothing_but_the_picture(stand) -> None:  # noqa: F811
    client, digests = stand
    heli = digests[HELI]
    ref = (await save(client, heli, "Санта на унитазе")).json()["id"]
    no_reason = await client.post(f"/reference/api/references/{ref}/erase-forever", json={"reason": " "})
    assert no_reason.status_code == 422, "удалено без причины"
    r = await client.post(f"/reference/api/references/{ref}/erase-forever", json={"reason": "зашквар"})
    assert r.status_code == 204, r.text
    assert (await client.get(f"/reference/api/references/{ref}")).status_code == 404
    assert ref not in [c["id"] for c in (await client.get("/reference/api/references/trash")).json()], "ушёл в корзину"
    assert ref not in [c["id"] for c in (await client.get("/reference/api/references/find", params={"q": "вертолёт"})).json()]
    item = next(i for i in (await client.get("/reference/api/assets/library")).json() if i["digest"] == heli)
    assert item["references"] == [], "связь с картинкой осталась"


async def test_defect_hides_the_picture_and_is_recognised_when_uploaded_again(stand) -> None:  # noqa: F811
    client, digests = stand
    heli = digests[HELI]
    try:
        assert (await client.post(f"/reference/api/assets/{heli}/defect", json={"reason": ""})).status_code == 422
        r = await client.post(f"/reference/api/assets/{heli}/defect", json={"reason": "Санта на унитазе — зашквар"})
        assert r.status_code == 204, r.text
        assert heli not in {i["digest"] for i in (await client.get("/reference/api/assets/library")).json()}
        marked = (await client.get("/reference/api/assets/library", params={"defects": "true"})).json()
        assert [i["digest"] for i in marked] == [heli] and marked[0]["defect"]["reason"] == "Санта на унитазе — зашквар"
        found = (await client.get("/reference/api/assets/search", params={"q": "вертолёт"})).json()
        assert heli not in [f["digest"] for f in found], "брак в выдаче"

        # Та же картинка, уменьшенная вдвое, — другой файл, но брак узнаётся.
        img = Image.open(io.BytesIO((PRINTS / HELI).read_bytes()))
        small = io.BytesIO()
        img.resize((img.width // 2, img.height // 2)).save(small, format="PNG")
        up = await client.post("/reference/api/assets", files=[("files", ("вертолёт-копия.png", small.getvalue(), "image/png"))])
        copy = up.json()[0]["digest"]
        assert copy != heli
        rec = (await client.post("/reference/api/assets/recognise", json=[copy])).json()[0]
        assert rec["defect"] and rec["defect"]["reason"] == "Санта на унитазе — зашквар", f"брак не узнан: {rec.get('defect')}"

        refused = await save(client, copy, "попытка")
        assert refused.status_code == 422 and "забракована" in refused.text, "забракованная легла в референс"
    finally:
        await client.delete(f"/reference/api/assets/{heli}/defect")
    assert heli in {i["digest"] for i in (await client.get("/reference/api/assets/library")).json()}, "брак не снялся"


def test_rights_for_erasing_and_marking() -> None:
    app = create_app(without_platform=False)
    app.state.keys = FixedKeys()
    with TestClient(app) as c:
        chief_without = bearer("references:view", "references:write", "references:delete", "references:purge-trash")
        assert c.post("/reference/api/references/1/erase-forever", json={"reason": "x"}, headers=chief_without).status_code == 404
        assert c.post("/reference/api/assets/" + "a" * 64 + "/defect", json={"reason": "x"},
                      headers=bearer("prints:view", "prints:write")).status_code == 404

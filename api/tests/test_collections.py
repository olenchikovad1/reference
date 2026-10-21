"""Разработка коллекции (решение 0020): варианты на базах, метки, «новое».

PLM здесь подменён: коллекция и базы приходят из его машинного входа, а
проверяется своё — карточки вариантов, метки и отметки «видел».
"""

import io

import httpx
import pytest
import pytest_asyncio

from reference_api.app import create_app
from reference_api.services import collections as service
from reference_api.services import plm
from tests.test_assets_api import png

RELEASE = "01M3MH76PKDR31QS7X1Y210XY1"
STYLE = "01STYLE00000000000000000001"
WHITE, PINK = "01CW0000000000000000000001", "01CW0000000000000000000002"
STARTING = ("Смотреть директору", "Правки директора", "Согласовано директором", "Готово — отдано фабрике")
BASE = "/reference/api/collections"

RELEASE_CARD = {
    "id": RELEASE,
    "code": "2026 AW LPR 3 2-end FT UZ GIRL SHIBO ARNASOY",
    "drop_code": "AW-AUT-APP-08",
    "supplier": "Arnasoy",
    "product": "Елена Федичева",
    "team": [{"role": "Продакт", "name": "Елена Федичева"}],
    "styles": [
        {
            "id": STYLE,
            "code": "1895",
            "name": "Лонгслив",
            "colorways": [
                {
                    "id": WHITE,
                    "article": "LRTT-1895-WHITE-001",
                    "color": "WHITE",
                    "rgb": [255, 255, 255],
                    "images": [
                        {"key": "img-front", "name": "1895_WHITE.png", "side": "front", "primary": True},
                        {"key": "img-back", "name": "1895_WHITE_Back.png", "side": "back", "primary": False},
                    ],
                },
                {"id": PINK, "article": "LRTT-1895-PINK-002", "color": "12-2905 TPG", "rgb": [231, 205, 217]},
            ],
        }
    ],
}


@pytest_asyncio.fixture
async def client(monkeypatch):
    from sqlalchemy import text

    from reference_api.db import engine

    async def card(_base, _key, release_id, **_):
        if release_id != RELEASE:
            raise plm.PlmMissing("plm ответил 404")
        return RELEASE_CARD

    async def releases(_base, _key, **_):
        return [{"id": RELEASE, "code": RELEASE_CARD["code"], "colorways": 2}]

    monkeypatch.setattr(service, "_plm", lambda: ("http://plm", "key"))
    monkeypatch.setattr(plm, "release_card", card)
    monkeypatch.setattr(plm, "list_releases", releases)
    app = create_app()
    async with app.router.lifespan_context(app):
        async with engine.begin() as conn:
            await conn.execute(text("truncate table reference_cards, reference_versions cascade"))
            await conn.execute(
                text("delete from collection_labels where not (name = any(:names))"), {"names": list(STARTING)}
            )
            await conn.execute(text("update collection_labels set active = true"))
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://stand") as c:
            yield c
    await engine.dispose()


def _as(who: str) -> dict[str, str]:
    return {"X-Stand-As": who}


async def _add(client, colorway: str, *images: tuple[str, bytes], headers=None) -> httpx.Response:
    files = [("files", (name, io.BytesIO(data), "image/png")) for name, data in images]
    return await client.post(
        f"{BASE}/{RELEASE}/variants",
        data={"style_id": STYLE, "colorway_id": colorway},
        files=files,
        headers=headers or {},
    )


def _column(board: dict, colorway: str) -> list[dict]:
    return next(c for b in board["bases"] for c in b["colours"] if c["colorway_id"] == colorway)["variants"]


async def _labels(client) -> dict[str, int]:
    return {one["name"]: one["id"] for one in (await client.get(f"{BASE}/labels")).json()}


# --- правила без базы ---------------------------------------------------------


@pytest.mark.parametrize(
    ("author", "number", "seen", "viewer", "expected"),
    [
        ("anna", 1, None, "kristina", True),
        ("anna", 2, 1, "kristina", True),
        ("anna", 2, 2, "kristina", False),
        ("anna", 1, None, "anna", False),
        ("anna", 1, None, None, False),
    ],
)
def test_новое_пока_не_открыл_и_не_своё(author, number, seen, viewer, expected) -> None:
    assert service.is_new(author, number, seen, viewer) is expected


def test_перед_и_спина_базы_берутся_из_рендеров_сторон() -> None:
    views = service.base_views(RELEASE_CARD["styles"][0]["colorways"])
    assert views["front"] == {"key": "img-front", "article": "LRTT-1895-WHITE-001", "exact": True}
    assert views["back"]["key"] == "img-back"


def test_без_рендера_спереди_перед_показывает_главную_картинку_с_пометкой() -> None:
    views = service.base_views([{"article": "A", "images": [{"key": "photo", "side": None, "primary": True}]}])
    assert views == {"front": {"key": "photo", "article": "A", "exact": False}, "back": None}


# --- доска --------------------------------------------------------------------


async def test_пачка_картинок_ложится_вариантами_в_колонку_цвета(client) -> None:
    r = await _add(client, PINK, ("a.png", png(60, 40, shade=10)), ("b.png", png(60, 40, shade=20)))
    assert r.status_code == 200, r.text
    assert [one["name"] for one in r.json()] == ["12-2905 TPG · вариант 1", "12-2905 TPG · вариант 2"]

    board = (await client.get(f"{BASE}/{RELEASE}")).json()
    assert board["collection"]["supplier"] == "Arnasoy"
    assert board["collection"]["product"] == "Елена Федичева"
    pink = _column(board, PINK)
    assert [v["number"] for v in pink] == [1, 1]
    assert {v["author_id"] for v in pink} == {"stand"}
    assert _column(board, WHITE) == []


async def test_вариант_не_попадает_на_витрину_референсов(client) -> None:
    """Витрина показывает обычные референсы, а вариант живёт на доске.
    Обычный кладётся репозиторием: сохранение через маршрут зовёт узнавание,
    а ему нужны модели стенда."""
    from reference_api.db import session_factory
    from reference_api.repositories import references as references_repo

    await _add(client, PINK, ("a.png", png(60, 40, shade=30)))
    async with session_factory() as db:
        ordinary = await references_repo.create(db, "обычный")
        await references_repo.add_version(db, ordinary, "обычный", "0" * 64, [], [], None, None)
    listed = [card["id"] for card in (await client.get("/reference/api/references")).json()]
    assert listed == [ordinary.id]


async def test_цветомодель_не_из_коллекции_отказ_и_ничего_не_заведено(client) -> None:
    r = await _add(client, "01CW-OTHER", ("a.png", png(60, 40, shade=40)))
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "colorway_not_in_collection"
    assert (await client.get(f"{BASE}")).json()["items"][0]["variants"] == 0


async def test_не_картинка_в_пачке_отказывает_всей_пачке(client) -> None:
    r = await _add(client, PINK, ("a.png", png(60, 40, shade=50)), ("b.png", b"not an image"))
    assert r.status_code == 415
    assert _column((await client.get(f"{BASE}/{RELEASE}")).json(), PINK) == []


async def test_нет_такой_коллекции_404(client) -> None:
    r = await client.get(f"{BASE}/01UNKNOWN")
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "collection_missing"


async def test_новое_гаснет_когда_открыл_а_у_автора_его_нет(client) -> None:
    await _add(client, WHITE, ("a.png", png(60, 40, shade=60)), headers=_as("anna"))
    mine = _column((await client.get(f"{BASE}/{RELEASE}", headers=_as("anna"))).json(), WHITE)[0]
    theirs = _column((await client.get(f"{BASE}/{RELEASE}", headers=_as("viktoria"))).json(), WHITE)[0]
    assert mine["is_new"] is False
    assert theirs["is_new"] is True

    assert (await client.post(f"{BASE}/variants/{theirs['id']}/seen", headers=_as("viktoria"))).status_code == 204
    again = _column((await client.get(f"{BASE}/{RELEASE}", headers=_as("viktoria"))).json(), WHITE)[0]
    assert again["is_new"] is False


# --- метки --------------------------------------------------------------------


async def test_стартовые_метки_на_месте(client) -> None:
    assert tuple(await _labels(client)) == STARTING


async def test_метка_ставится_снимается_и_пишется_в_историю(client) -> None:
    from sqlalchemy import text

    from reference_api.db import engine

    variant = (await _add(client, PINK, ("a.png", png(60, 40, shade=70)))).json()[0]["id"]
    look = (await _labels(client))["Смотреть директору"]
    r = await client.put(f"{BASE}/variants/{variant}/label", json={"label_id": look})
    assert r.status_code == 204
    assert _column((await client.get(f"{BASE}/{RELEASE}")).json(), PINK)[0]["label_id"] == look

    await client.put(f"{BASE}/variants/{variant}/label", json={"label_id": None})
    async with engine.connect() as conn:
        history = (
            await conn.execute(
                text("select label_id from reference_label_events where reference_id = :r order by id"),
                {"r": variant},
            )
        ).scalars().all()
    assert history == [look, None]


async def test_погашенную_метку_новой_карточке_не_поставить(client) -> None:
    variant = (await _add(client, PINK, ("a.png", png(60, 40, shade=80)))).json()[0]["id"]
    done = (await _labels(client))["Готово — отдано фабрике"]
    assert (await client.patch(f"{BASE}/labels/{done}", json={"active": False})).status_code == 200
    r = await client.put(f"{BASE}/variants/{variant}/label", json={"label_id": done})
    assert r.status_code == 422


async def test_метку_заводят_и_правят_сами_а_удаления_нет(client) -> None:
    r = await client.post(f"{BASE}/labels", json={"name": "Отложено на сезон", "tone": "violet"})
    assert r.status_code == 200, r.text
    made = r.json()
    assert made["position"] == 4

    assert (await client.post(f"{BASE}/labels", json={"name": "отложено  на сезон"})).status_code == 422
    assert (await client.post(f"{BASE}/labels", json={"name": "Другое", "tone": "#ff0000"})).status_code == 422
    renamed = await client.patch(f"{BASE}/labels/{made['id']}", json={"name": "На потом", "tone": "slate"})
    assert renamed.json()["name"] == "На потом"
    assert (await client.delete(f"{BASE}/labels/{made['id']}")).status_code == 405


def test_чужая_метка_после_моего_взгляда_новое_и_для_автора() -> None:
    from datetime import UTC, datetime, timedelta

    looked = datetime(2026, 10, 21, 18, tzinfo=UTC)
    night = looked + timedelta(hours=8)
    assert service.is_new("anna", 1, 1, "anna", label_by="viktoria", label_at=night, seen_at=looked) is True
    assert service.is_new("anna", 1, 1, "anna", label_by="viktoria", label_at=night, seen_at=night + timedelta(hours=1)) is False
    assert service.is_new("anna", 1, 1, "anna", label_by="anna", label_at=night, seen_at=looked) is False


async def test_утром_автор_видит_метку_поставленную_ночью(client) -> None:
    variant = (await _add(client, PINK, ("a.png", png(60, 40, shade=90)), headers=_as("anna"))).json()[0]["id"]
    agreed = (await _labels(client))["Согласовано директором"]
    await client.put(f"{BASE}/variants/{variant}/label", json={"label_id": agreed}, headers=_as("viktoria"))
    mine = _column((await client.get(f"{BASE}/{RELEASE}", headers=_as("anna"))).json(), PINK)[0]
    assert mine["is_new"] is True
    assert mine["label_by"] == "viktoria"
    await client.post(f"{BASE}/variants/{variant}/seen", headers=_as("anna"))
    mine = _column((await client.get(f"{BASE}/{RELEASE}", headers=_as("anna"))).json(), PINK)[0]
    assert mine["is_new"] is False


async def test_идеи_базы_без_цвета_и_перенос_в_колонку_со_всеми_данными(client) -> None:
    files = [("files", (n, io.BytesIO(png(50, 50, shade=s)), "image/png")) for n, s in (("a.png", 100), ("b.png", 110))]
    r = await client.post(f"{BASE}/{RELEASE}/variants", data={"style_id": STYLE}, files=files, headers=_as("viktoria"))
    assert r.status_code == 200, r.text
    first, second = (one["id"] for one in r.json())
    board = (await client.get(f"{BASE}/{RELEASE}")).json()
    assert [v["id"] for v in board["bases"][0]["ideas"]] == [second, first]

    look = (await _labels(client))["Смотреть директору"]
    await client.put(f"{BASE}/variants/{first}/label", json={"label_id": look})
    moved = await client.put(f"{BASE}/{RELEASE}/place", json={"style_id": STYLE, "colorway_id": PINK, "ids": [first]})
    assert moved.status_code == 204, moved.text
    board = (await client.get(f"{BASE}/{RELEASE}")).json()
    pink = _column(board, PINK)
    assert [v["id"] for v in pink] == [first]
    assert pink[0]["label_id"] == look and pink[0]["author_id"] == "viktoria"
    assert [v["id"] for v in board["bases"][0]["ideas"]] == [second]


async def test_порядок_в_колонке_общий_и_новое_встаёт_наверх(client) -> None:
    a, b = (one["id"] for one in (await _add(client, PINK, ("a.png", png(60, 40, shade=120)), ("b.png", png(60, 40, shade=130)))).json())
    c = (await _add(client, PINK, ("c.png", png(60, 40, shade=140)))).json()[0]["id"]
    assert [v["id"] for v in _column((await client.get(f"{BASE}/{RELEASE}")).json(), PINK)] == [c, b, a]
    await client.put(f"{BASE}/{RELEASE}/place", json={"style_id": STYLE, "colorway_id": PINK, "ids": [a, c, b]})
    as_other = _column((await client.get(f"{BASE}/{RELEASE}", headers=_as("kristina"))).json(), PINK)
    assert [v["id"] for v in as_other] == [a, c, b]


async def test_отложено_не_удаляет_и_возвращается(client) -> None:
    variant = (await _add(client, PINK, ("a.png", png(60, 40, shade=150)))).json()[0]["id"]
    assert (await client.put(f"{BASE}/variants/{variant}/shelf", json={"shelved": True})).status_code == 204
    board = (await client.get(f"{BASE}/{RELEASE}")).json()
    assert _column(board, PINK) == []
    assert [v["id"] for v in board["bases"][0]["shelf"]] == [variant]

    await client.put(f"{BASE}/{RELEASE}/place", json={"style_id": STYLE, "colorway_id": WHITE, "ids": [variant]})
    board = (await client.get(f"{BASE}/{RELEASE}")).json()
    assert board["bases"][0]["shelf"] == []
    assert [v["id"] for v in _column(board, WHITE)] == [variant]


async def test_перенос_чужой_карточки_или_в_чужую_колонку_отказ(client) -> None:
    variant = (await _add(client, PINK, ("a.png", png(60, 40, shade=160)))).json()[0]["id"]
    wrong = await client.put(f"{BASE}/{RELEASE}/place", json={"style_id": STYLE, "colorway_id": "01CW-OTHER", "ids": [variant]})
    assert wrong.status_code == 422
    missing = await client.put(f"{BASE}/{RELEASE}/place", json={"style_id": STYLE, "colorway_id": PINK, "ids": [variant, 999999]})
    assert missing.status_code == 404


async def test_хранение_готово_к_пакету_codex_без_модели_и_с_ключом_серии(client) -> None:
    """Пакет «lpr-reference/1» ляжет без переделок: вариант без модели
    допустим, ключ серии один на коллекцию — r2 найдёт свою карточку, повтор
    импорта дубля не даст (импорт — следующий срез)."""
    from sqlalchemy.exc import IntegrityError

    from reference_api.db import session_factory
    from reference_api.models.references import Reference

    async with session_factory() as db:
        db.add(Reference(name="B01-V1-Б", plm_release_id=RELEASE, external_key="B01-V1-Б"))
        await db.commit()
    async with session_factory() as db:
        db.add(Reference(name="B01-V1-Б повтор", plm_release_id=RELEASE, external_key="B01-V1-Б"))
        with pytest.raises(IntegrityError):
            await db.commit()
    async with session_factory() as db:
        db.add(Reference(name="без релиза, но с цветом", plm_colorway_id=PINK))
        with pytest.raises(IntegrityError):
            await db.commit()

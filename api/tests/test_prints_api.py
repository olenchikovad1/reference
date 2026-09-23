"""Набор принтов: то, чем пользуются постоянно.

Проверяется не «список отдаётся», а то, ради чего он существует: эталоны должны
быть под рукой одним нажатием, а настоящие принты — попадать в тот же список
тем же способом, без отдельного пути.
"""

import pytest
from fastapi.testclient import TestClient

from reference_api.app import create_app


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(create_app())


def test_catalogue_has_both_probes_and_artwork(client: TestClient) -> None:
    """В одном списке и эталоны, и настоящие принты.

    Отдельный путь для эталонов означал бы, что настоящий принт, положенный в
    том, в интерфейсе не появится, — и человек пойдёт искать поломку.
    """
    items = client.get("/reference/api/prints").json()
    kinds = {i["kind"] for i in items}
    assert kinds == {"probe", "artwork"}


def test_every_probe_says_what_it_answers(client: TestClient) -> None:
    """У эталона назван вопрос, на который он отвечает, а не имя файла."""
    probes = [i for i in client.get("/reference/api/prints").json() if i["kind"] == "probe"]
    assert len(probes) >= 5
    for p in probes:
        assert p["answers"], f"{p['name']} не говорит, на что отвечает"


def test_real_prints_are_listed_even_without_description(client: TestClient) -> None:
    """Файл без описания всё равно в наборе: иначе он молча исчезает."""
    items = client.get("/reference/api/prints").json()
    assert any(i["kind"] == "artwork" for i in items)


def test_print_content_is_served(client: TestClient) -> None:
    items = client.get("/reference/api/prints").json()
    r = client.get(f"/reference/api/prints/{items[0]['path']}")
    assert r.status_code == 200
    assert r.content[:8] == b"\x89PNG\r\n\x1a\n"


def test_escaping_the_set_is_refused(client: TestClient) -> None:
    """Выход за корень набора отвергается: путь приходит снаружи."""
    r = client.get("/reference/api/prints/../../fixtures/palette.yaml")
    assert r.status_code == 404

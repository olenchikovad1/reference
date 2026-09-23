"""Палитра: то, чем красят изделие и надписи.

Проверяется главное свойство: цвет опознаётся КОДОМ. На фабрику уходит код
пантона, а не оттенок, снятый с экрана, — иначе утверждённый цвет и
напечатанный расходятся, и доказать ничего нельзя.
"""

import pytest
from fastapi.testclient import TestClient

from reference_api.app import create_app


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(create_app())


def test_palette_is_served(client: TestClient) -> None:
    r = client.get("/reference/api/colours")
    assert r.status_code == 200
    assert len(r.json()["colors"]) >= 10


def test_every_colour_carries_its_code(client: TestClient) -> None:
    """У каждого цвета есть код: без него он неотличим от оттенка с экрана."""
    for c in client.get("/reference/api/colours").json()["colors"]:
        assert c["code"]
        assert c["code_short"]


def test_palette_spans_from_black_to_white(client: TestClient) -> None:
    """В наборе есть и чёрный, и белый.

    Чёрный — не украшение набора, а главная проверка перекраски: именно на нём
    наивное умножение превращает изделие в плоское пятно.
    """
    by_code = {c["code"]: c for c in client.get("/reference/api/colours").json()["colors"]}
    assert by_code["BLACK"]["rgb"] == [0, 0, 0]
    assert by_code["WHITE"]["rgb"] == [255, 255, 255]


def test_colours_are_contrasting_enough_to_tell_apart(client: TestClient) -> None:
    """Цвета в наборе различимы между собой.

    Набор существует ради проверки перекраски, и десять оттенков одного
    бежевого её не проверяют. Мера грубая нарочно: точная мера цвета — забота
    справочника, а не наша.
    """
    colors = client.get("/reference/api/colours").json()["colors"]
    pairs = [
        (a, b)
        for i, a in enumerate(colors)
        for b in colors[i + 1 :]
        if sum(abs(x - y) for x, y in zip(a["rgb"], b["rgb"])) < 60
    ]
    assert pairs == [], f"слишком близкие цвета: {[(a['code'], b['code']) for a, b in pairs]}"


def test_source_is_named(client: TestClient) -> None:
    """Сказано, откуда палитра взята: она переедет, и след должен остаться."""
    assert client.get("/reference/api/colours").json()["source"] == "cosmicplm-db"

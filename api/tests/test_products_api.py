"""Маршрут описания изделия — то, на чём стоит вся страница стенда.

Проверяется не «эндпоинт отвечает 200», а то, ради чего он существует: страница
обязана узнать из данных, сколько пикселей в сантиметре, предварительно ли это
число, по какому ракурсу можно размещать, а по какому нельзя, и где лежит
капюшон, закрывающий верх спины.
"""

import pytest
from fastapi.testclient import TestClient

from reference_api.app import create_app


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(create_app())


def test_product_is_served_with_its_states(client: TestClient) -> None:
    """Изделие отдаётся вместе с состояниями и их видом."""
    r = client.get("/reference/api/products/B-HDY-14")
    assert r.status_code == 200
    body = r.json()
    assert body["code"] == "B-HDY-14"
    assert [s["code"] for s in body["states"]] == ["front", "back", "left"]


def test_calibration_says_it_is_provisional(client: TestClient) -> None:
    """Калибровка помечена предварительной.

    Без пометки число неотличимо от измеренного, а разница между 98-м и 164-м
    размером здесь больше половины: принять прикидку за факт значит отправить на
    фабрику печать в полтора раза не того размера.
    """
    body = client.get("/reference/api/products/B-HDY-14").json()
    # 7.38 — не измерено на этом изделии, а принято: типовая длина спинки на 134
    # из табелей Cosmic на 388 пикселей кадра. Поэтому пометка и обязательна.
    assert body["calibration"]["px_per_cm"] == pytest.approx(7.38)
    assert body["calibration"]["provisional"] is True
    assert body["rendered_size"] is None


def test_side_view_is_marked_illustrative(client: TestClient) -> None:
    """Боковой ракурс нельзя использовать для размещения, и это видно из данных.

    Силуэт там сокращён втрое. Страница должна знать это из ответа, а не
    полагаться на память того, кто её открыл.
    """
    states = {s["code"]: s for s in client.get("/reference/api/products/B-HDY-14").json()["states"]}
    assert states["front"]["kind"] == "precise"
    assert states["back"]["kind"] == "precise"
    assert states["left"]["kind"] == "illustrative"


def test_back_has_a_hood_zone_over_the_print_area(client: TestClient) -> None:
    """У спины описан капюшон, и он перекрывает верх печатной зоны.

    Это и есть ответ на «а капюшон это не закроет?». Без зоны кадр спины врёт в
    самом важном месте: принт, нарисованный сверху, показывает то, чего не бывает.
    """
    states = {s["code"]: s for s in client.get("/reference/api/products/B-HDY-14").json()["states"]}
    back = states["back"]
    hood = back["zones"]["hood"]
    print_zone = back["zones"]["print"]
    assert len(hood) >= 3
    # Капюшон кончается ровно там, где начинается печатное поле. Это измеренная
    # геометрия, а не пожелание: низ капюшона на 179, верх поля на 180. Значит
    # принт, сдвинутый вверх хотя бы немного, уходит под капюшон — и именно на
    # этом действии обязана срабатывать проверка перекрытия.
    hood_bottom = max(y for _x, y in hood)
    print_top = min(y for _x, y in print_zone)
    assert abs(hood_bottom - print_top) <= 5, (
        f"капюшон кончается на {hood_bottom}, поле начинается на {print_top}: "
        "между ними зазор, и перекрытие не наступит никогда"
    )


def test_anchors_are_given_for_precise_views(client: TestClient) -> None:
    """У точных ракурсов есть горловина и подол: от них отсчитывается размещение."""
    states = {s["code"]: s for s in client.get("/reference/api/products/B-HDY-14").json()["states"]}
    for code in ("front", "back"):
        anchors = states[code]["anchors"]
        assert "neck" in anchors and "hem" in anchors
        assert anchors["neck"][1] < anchors["hem"][1]


def test_frame_is_served_as_an_image(client: TestClient) -> None:
    """Кадр отдаётся байтами PNG из тома, а не ссылкой в никуда."""
    r = client.get("/reference/api/products/B-HDY-14/states/front/frame")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    assert r.content[:8] == b"\x89PNG\r\n\x1a\n"


def test_unknown_product_is_refused_clearly(client: TestClient) -> None:
    """Неизвестное изделие даёт внятный отказ, а не пустой ответ."""
    r = client.get("/reference/api/products/NO-SUCH")
    assert r.status_code == 404
    assert "NO-SUCH" in r.json()["detail"]


def test_missing_frame_file_names_what_is_missing(client: TestClient) -> None:
    """Пустой том — штатный случай, и отказ обязан называть недостающий файл.

    На чистой машине тома нет вовсе. Молчаливая пустая картинка отправит
    разбираться в код вместо того, чтобы положить файл на место.
    """
    r = client.get("/reference/api/products/B-HDY-14/states/no-such-state/frame")
    assert r.status_code == 404
    assert "no-such-state" in r.json()["detail"]


def test_lowered_hood_comes_with_its_source_and_is_marked_provisional(client) -> None:
    """Граница опущенного капюшона — расчётная, и это видно (US-0519): длина
    капюшона из табелей Cosmic по размерам и доля, которую он закрывает."""
    p = client.get("/reference/api/products/B-HDY-14").json()
    hd = p["hood_down"]
    assert hd["provisional"] is True and "Cosmic" in hd["source"]
    assert hd["length_cm_by_size"]["134"] == 34.5 and hd["length_cm_by_size"]["98"] < hd["length_cm_by_size"]["164"]
    back = next(s for s in p["states"] if s["code"] == "back")
    assert len(back["zones"]["hood_down"]) >= 3

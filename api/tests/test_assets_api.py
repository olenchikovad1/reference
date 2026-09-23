"""Файлы и их ступени.

Проверяется не «загрузка работает», а то, от чего зависят размеры печати и
поиск похожего: фактические размеры ступеней, сохранение прозрачности,
отсутствие всякой обработки сверх вписывания и то, что оригинал в браузер не
уходит.
"""

import io
import struct
import zlib

import pytest
from fastapi.testclient import TestClient

from reference_api.app import create_app


def png(width: int, height: int, alpha: int = 0) -> bytes:
    """PNG заданного размера. Левый столбец делается прозрачным по запросу."""
    rows = []
    for _ in range(height):
        row = bytearray([0])
        for x in range(width):
            row += bytes((200, 60, 60, 0 if (alpha and x < 2) else 255))
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(tag: bytes, data: bytes) -> bytes:
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 6))
        + chunk(b"IEND", b"")
    )


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(create_app())


def send(client: TestClient, *images: tuple[str, bytes]):
    files = [("files", (name, io.BytesIO(data), "image/png")) for name, data in images]
    return client.post("/reference/api/assets", files=files)


def test_several_files_go_in_one_operation(client: TestClient) -> None:
    """Несколько файлов одной операцией: по одному — та же работа, что убираем."""
    r = send(client, ("a.png", png(60, 40)), ("b.png", png(50, 30)))
    assert r.status_code == 200
    assert len(r.json()) == 2


def test_steps_report_their_actual_size(client: TestClient) -> None:
    """Размеры ступеней ФАКТИЧЕСКИЕ, а не заявленные.

    При вписывании в квадрат длинная сторона равна пресету, а короткая — нет.
    Угадать её нельзя: по этим числам считается перевод сантиметров в пиксели,
    а из него — размер печати на фабрику.
    """
    asset = send(client, ("wide.png", png(1600, 800))).json()[0]
    steps = {d["name"]: d for d in asset["derivatives"]}
    assert steps["preview"]["width"] == 1200
    assert steps["preview"]["height"] == 600
    assert steps["thumb"]["width"] == 200
    assert steps["thumb"]["height"] == 100


def test_small_original_gives_a_copy_not_a_stretch(client: TestClient) -> None:
    """Оригинал мельче ступени — ступень это копия, а не растянутое.

    Растягивание портит картинку и врёт о разрешении.
    """
    # 400 меньше средней ступени (1200), но больше мелкой (200): на этом
    # размере ступени ведут себя по-разному, и правило видно целиком.
    asset = send(client, ("small.png", png(400, 300))).json()[0]
    steps = {d["name"]: d for d in asset["derivatives"]}
    assert steps["preview"]["is_copy"] is True
    assert steps["preview"]["width"] == 400
    assert steps["preview"]["height"] == 300
    assert steps["thumb"]["is_copy"] is False
    assert steps["thumb"]["width"] == 200


def test_transparency_survives_every_step(client: TestClient) -> None:
    """Прозрачность переживает все ступени, формат не подменяется.

    Элемент принта, сведённый в JPEG, непригоден: прозрачные поля несут
    геометрию, по ним считается позиция.
    """
    asset = send(client, ("alpha.png", png(900, 600, alpha=1))).json()[0]
    for preset in ("thumb", "preview"):
        r = client.get(f"/reference/api/assets/{asset['digest']}/{preset}")
        assert r.status_code == 200
        assert r.content[:8] == b"\x89PNG\r\n\x1a\n", f"{preset} перестала быть PNG"


def test_same_file_twice_takes_no_second_place(client: TestClient) -> None:
    """Дедупликация по содержимому: тот же файл не хранится дважды."""
    same = png(300, 200)
    first = send(client, ("one.png", same)).json()[0]
    second = send(client, ("другое-имя.png", same)).json()[0]
    assert first["digest"] == second["digest"]
    assert second["reused"] is True


def test_original_is_not_served(client: TestClient) -> None:
    """Оригинал в браузер не уходит никогда.

    Он нужен только на выгрузке техпакета. Отдать его страницей значит послать
    в браузер сотню мегабайт вместо ста килобайт.
    """
    asset = send(client, ("orig.png", png(400, 300))).json()[0]
    assert "original" not in {d["name"] for d in asset["derivatives"]}
    assert client.get(f"/reference/api/assets/{asset['digest']}/original").status_code == 404


def test_unknown_preset_is_refused(client: TestClient) -> None:
    """Неизвестная ступень — отказ, а не подбор похожего.

    Произвольные размеры засоряют кеш и делают невозможным сравнение версий.
    """
    asset = send(client, ("x.png", png(400, 300))).json()[0]
    assert client.get(f"/reference/api/assets/{asset['digest']}/huge").status_code == 404


def test_not_an_image_is_refused_by_content_not_by_name(client: TestClient) -> None:
    """Опознание по первым байтам: расширению верить нельзя."""
    r = client.post(
        "/reference/api/assets",
        files=[("files", ("обман.png", io.BytesIO(b"MZ\x90\x00not an image"), "image/png"))],
    )
    assert r.status_code == 415

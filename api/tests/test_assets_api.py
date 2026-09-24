"""Файлы, их ступени и узнавание похожего.

Проверяется не «загрузка работает», а то, от чего зависят размеры печати и
поиск похожего: фактические размеры ступеней, сохранение прозрачности,
отсутствие всякой обработки сверх вписывания и то, что оригинал в браузер не
уходит.
"""

import io
import struct
import zlib

import httpx
import pytest_asyncio

from reference_api.app import create_app


def png(width: int, height: int, alpha: int = 0, shade: int = 60) -> bytes:
    """PNG заданного размера. Левый столбец делается прозрачным по запросу."""
    rows = []
    for _ in range(height):
        row = bytearray([0])
        for x in range(width):
            row += bytes((200, shade, shade, 0 if (alpha and x < 2) else 255))
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


# Клиент асинхронный, а не TestClient. Причина не в стиле: TestClient крутит
# каждый запрос в отдельном цикле событий, а движок базы привязан к одному, и
# asyncpg отказывается работать через границу циклов. Понижать пул движка ради
# оснастки значило бы лечить продакшен от болезни тестов.
@pytest_asyncio.fixture
async def client():
    # Пул соединений освобождается после каждого теста: у каждого свой цикл
    # событий, а asyncpg через границу циклов работать отказывается. Дешевле
    # отпустить пул в оснастке, чем отключить его в продакшене.
    from sqlalchemy import text

    from reference_api.db import engine

    app = create_app()
    async with app.router.lifespan_context(app):
        # Векторы прошлого прогона убираются: файлы у нас детерминированные, и
        # оставленный вектор узнаётся следующим прогоном как «уже было». Тест
        # тогда проходит по чужому наследству, а не по тому, что проверяет.
        # Чистить можно потому, что база тестовая (см. conftest).
        async with engine.begin() as conn:
            await conn.execute(
                text("truncate table asset_embeddings, reference_cards, reference_texts")
            )
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://stand"
        ) as c:
            yield c
    await engine.dispose()


async def send(client, *images: tuple[str, bytes]):
    files = [("files", (name, io.BytesIO(data), "image/png")) for name, data in images]
    return await client.post("/reference/api/assets", files=files)


async def test_several_files_go_in_one_operation(client) -> None:
    """Несколько файлов одной операцией: по одному — та же работа, что убираем."""
    r = await send(client, ("a.png", png(60, 40)), ("b.png", png(50, 30)))
    assert r.status_code == 200
    assert len(r.json()) == 2


async def test_steps_report_their_actual_size(client) -> None:
    """Размеры ступеней ФАКТИЧЕСКИЕ, а не заявленные.

    При вписывании в квадрат длинная сторона равна пресету, а короткая — нет.
    Угадать её нельзя: по этим числам считается перевод сантиметров в пиксели,
    а из него — размер печати на фабрику.
    """
    asset = (await send(client, ("wide.png", png(1600, 800)))).json()[0]
    steps = {d["name"]: d for d in asset["derivatives"]}
    assert steps["preview"]["width"] == 1200
    assert steps["preview"]["height"] == 600
    assert steps["thumb"]["width"] == 200
    assert steps["thumb"]["height"] == 100


async def test_small_original_gives_a_copy_not_a_stretch(client) -> None:
    """Оригинал мельче ступени — ступень это копия, а не растянутое.

    Растягивание портит картинку и врёт о разрешении.
    """
    # 400 меньше средней ступени (1200), но больше мелкой (200): на этом
    # размере ступени ведут себя по-разному, и правило видно целиком.
    asset = (await send(client, ("small.png", png(400, 300)))).json()[0]
    steps = {d["name"]: d for d in asset["derivatives"]}
    assert steps["preview"]["is_copy"] is True
    assert steps["preview"]["width"] == 400
    assert steps["thumb"]["is_copy"] is False
    assert steps["thumb"]["width"] == 200


async def test_transparency_survives_every_step(client) -> None:
    """Прозрачность переживает все ступени, формат не подменяется.

    Элемент принта, сведённый в JPEG, непригоден: прозрачные поля несут
    геометрию, по ним считается позиция.
    """
    asset = (await send(client, ("alpha.png", png(900, 600, alpha=1)))).json()[0]
    for preset in ("thumb", "preview"):
        r = await client.get(f"/reference/api/assets/{asset['digest']}/{preset}")
        assert r.status_code == 200
        assert r.content[:8] == b"\x89PNG\r\n\x1a\n", f"{preset} перестала быть PNG"


async def test_same_file_twice_takes_no_second_place(client) -> None:
    """Дедупликация по содержимому: тот же файл не хранится дважды."""
    same = png(300, 200)
    first = (await send(client, ("one.png", same))).json()[0]
    second = (await send(client, ("другое-имя.png", same))).json()[0]
    assert first["digest"] == second["digest"]
    assert second["reused"] is True


async def test_original_is_not_served(client) -> None:
    """Оригинал в браузер не уходит никогда.

    Он нужен только на выгрузке техпакета. Отдать его страницей значит послать
    в браузер сотню мегабайт вместо ста килобайт.
    """
    asset = (await send(client, ("orig.png", png(400, 300)))).json()[0]
    assert "original" not in {d["name"] for d in asset["derivatives"]}
    r = await client.get(f"/reference/api/assets/{asset['digest']}/original")
    assert r.status_code == 404


async def test_unknown_preset_is_refused(client) -> None:
    """Неизвестная ступень — отказ, а не подбор похожего."""
    asset = (await send(client, ("x.png", png(400, 300)))).json()[0]
    r = await client.get(f"/reference/api/assets/{asset['digest']}/huge")
    assert r.status_code == 404


async def test_not_an_image_is_refused_by_content_not_by_name(client) -> None:
    """Опознание по первым байтам: расширению верить нельзя."""
    r = await client.post(
        "/reference/api/assets",
        files=[("files", ("обман.png", io.BytesIO(b"MZ\x90\x00not an image"), "image/png"))],
    )
    assert r.status_code == 415


async def recognise(client, *digests: str):
    r = await client.post("/reference/api/assets/recognise", json=list(digests))
    assert r.status_code == 200, r.text
    return {row["digest"]: row["matches"] for row in r.json()}


async def test_upload_does_not_wait_for_the_model(client) -> None:
    """Загрузка не ждёт модель.

    Модель считает около 90 мс на картинку — на десятке файлов это почти
    секунда, в течение которой брошенные картинки ещё не появились на изделии.
    Узнавание отдельным запросом, которого страница не ждёт.
    """
    asset = (await send(client, ("одна.png", png(300, 200, shade=11)))).json()[0]
    assert "matches" not in asset, "узнавание вернулось в ответ загрузки — человек снова ждёт модель"


async def test_the_same_picture_is_recognised_though_the_hash_differs(client) -> None:
    """Та же картинка узнаётся, хотя файл другой.

    Это и есть вторая сеть: хеш ловит ТОТ ЖЕ файл, вектор — ту же картинку,
    пересохранённую или изменённую. Первая пропускает, поэтому нужна вторая.
    """
    first = (await send(client, ("исходная.png", png(600, 400, shade=33)))).json()[0]
    second = (await send(client, ("увеличенная.png", png(900, 600, shade=33)))).json()[0]
    assert first["digest"] != second["digest"], "файлы обязаны быть разными"

    # Порядок важен: первую надо успеть запомнить, иначе второй не с чем
    # сравниваться.
    assert recognise and (await recognise(client, first["digest"]))[first["digest"]] == []
    seen = (await recognise(client, second["digest"]))[second["digest"]]

    assert "same" in {m["level"] for m in seen}, f"та же картинка не узналась: {seen}"
    assert seen[0]["name"] == "исходная.png", "в окне нечего показать: имя не дошло"


async def test_nothing_similar_gives_no_window(client) -> None:
    """Не нашлось — не показывается ничего.

    Окно «совпадений нет» превращает подсказку в помеху, и его перестают
    читать вместе с тем, ради чего оно заводилось.
    """
    lone = (await send(client, ("одинокая.png", png(300, 200, shade=200)))).json()[0]
    assert (await recognise(client, lone["digest"]))[lone["digest"]] == []


async def test_too_large_is_refused_like_the_platform_does(client, monkeypatch) -> None:
    """Слишком большой файл — отказ 413 с кодом платформы.

    Наше хранилище временное и повторяет договор сервиса файлов платформы
    (решение 0009). Предел там — 100 МБ на картинку; принимай мы больше,
    после переезда та же картинка вдруг получила бы отказ. Предел в тесте
    уменьшен, чтобы не гонять сто мегабайт.
    """
    from reference_api.services import assets as service

    # Однотонная PNG 60×60 сжимается до нескольких сотен байт — предел ниже.
    monkeypatch.setattr(service, "MAX_IMAGE_BYTES", 100)
    r = await send(client, ("огромный.png", png(60, 60)))
    assert r.status_code == 413, r.text
    detail = r.json()["detail"]
    assert detail["code"] == "file_too_large"
    # Причина словами: сколько весит, какой предел и куда девать исходник.
    assert "огромный.png" in detail["reason"]
    assert "том" in detail["reason"]

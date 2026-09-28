"""Замечание голосом: запись, расшифровка, прослушивание (план 075, US-0512).

Запись сохраняется сразу и остаётся первоисточником; расшифровка — в фоне,
пока её нет — «расшифровывается». Автор правит текст — запись прежняя.
Расшифровка не удалась — сказано, запись не потеряна. Модель здесь
подменена: настоящая Whisper гоняется в test_voice_model.py, в конце плана.
"""

import io
import pathlib

import httpx
import pytest_asyncio
from sqlalchemy import text

from reference_api.app import create_app
from reference_api.services import review

PRINTS = pathlib.Path("/srv/reference/files/prints")
IVANOVA, PETROV = "stand-ivanova", "stand-petrov"
API = "/reference/api"
#: Не звук, а байты с видом звука: расшифровку здесь делает подмена.
AUDIO = b"RIFF\x24\x00\x00\x00WAVEfmt " + bytes(40)


def as_(who: str) -> dict:
    return {"X-Stand-As": who}


@pytest_asyncio.fixture
async def client():
    from reference_api.db import engine

    app = create_app()
    async with app.router.lifespan_context(app):
        async with engine.begin() as conn:
            await conn.execute(text("truncate table app_people, reference_cards cascade"))
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://stand") as c:
            await c.put(f"{API}/people/{IVANOVA}", json={"full_name": "Иванова Мария", "role": "designer"})
            await c.put(f"{API}/people/{PETROV}", json={"full_name": "Петров Олег", "role": "editor"})
            yield c
    await engine.dispose()


async def reference(client) -> int:
    d = (await client.post(f"{API}/assets", files=[
        ("files", ("t72.png", io.BytesIO((PRINTS / "t72-winter-print.png").read_bytes()), "image/png"))])).json()[0]["digest"]
    r = await client.post(f"{API}/references", headers=as_(IVANOVA), json={
        "name": "танк", "sheet_digest": d, "image_digests": [d], "texts": []})
    return r.json()["id"]


async def speak(client, ref: int, who: str = PETROV, audio: bytes = AUDIO, kind: str = "audio/wav") -> httpx.Response:
    return await client.post(f"{API}/references/{ref}/remarks/voice", headers=as_(who),
                             files={"audio": ("remark.wav", io.BytesIO(audio), kind)},
                             data={"side": "back", "x": "0.4", "y": "0.3"})


async def remark(client, ref: int) -> dict:
    [m] = (await client.get(f"{API}/references/{ref}/remarks")).json()
    return m


async def test_voice_remark_is_heard_in_background_and_audio_stays(client) -> None:
    ref = await reference(client)
    r = await speak(client, ref)
    assert r.status_code == 200, r.text
    m = r.json()
    assert (m["audio"], m["voice_status"], m["text"]) == (True, "pending", ""), "сразу — «расшифровывается»"

    said = "танк сдвинь левее на два сантиметра, надпись чуть меньше, Об 268"
    assert await review.hear(m["id"], transcribe=lambda audio: (said, 3.2)) == ("done", 1)
    m = await remark(client, ref)
    assert (m["voice_status"], m["text"], m["heard"], m["audio_seconds"]) == ("done", said, said, 3.2)
    assert await review.hear(m["id"], transcribe=lambda audio: ("иначе", 1.0)) == ("skip", 0), \
        "повтор сообщения второй раз не расшифровывает"

    fixed = said.replace("Об 268", "Об. 268")
    r = await client.put(f"{API}/references/{ref}/remarks/{m['id']}/text", headers=as_(PETROV), json={"text": fixed})
    assert r.status_code == 200, r.text
    assert (r.json()["text"], r.json()["heard"]) == (fixed, said), "текст поправлен, «как услышано» прежнее"
    got = await client.get(f"{API}/references/{ref}/remarks/{m['id']}/audio")
    assert (got.status_code, got.content, got.headers["content-type"]) == (200, AUDIO, "audio/wav"), "запись прежняя"

    assert (await client.put(f"{API}/references/{ref}/remarks/{m['id']}/text", headers=as_(IVANOVA),
                             json={"text": "не то"})).status_code == 403, "чужой текст не правят"


async def test_failed_transcription_is_said_and_audio_is_kept(client) -> None:
    ref = await reference(client)
    rid = (await speak(client, ref)).json()["id"]

    def broken(audio: bytes):
        raise RuntimeError("модель не загрузилась")

    for attempt in (1, 2):
        assert await review.hear(rid, transcribe=broken) == ("retry", attempt)
        assert (await remark(client, ref))["voice_status"] == "pending"
    assert await review.hear(rid, transcribe=broken) == ("failed", 3), "попыток конечное число"
    m = await remark(client, ref)
    assert m["voice_status"] == "failed" and "модель не загрузилась" in m["voice_error"]
    assert (await client.get(f"{API}/references/{ref}/remarks/{rid}/audio")).content == AUDIO, "запись не потеряна"


async def test_silence_fails_at_once_and_pending_ones_resume(client) -> None:
    ref = await reference(client)
    rid = (await speak(client, ref)).json()["id"]
    assert await review.hear(rid, transcribe=lambda audio: ("  ", 1.0)) == ("failed", 1), \
        "ошибка в самой записи не повторяется"
    assert "не расслышано" in (await remark(client, ref))["voice_error"]

    other = (await speak(client, ref)).json()["id"]
    from reference_api.db import engine

    async with engine.begin() as conn:
        await conn.execute(text("update reference_remarks set voice_status = 'working' where id = :i"), {"i": other})
    assert await review.resume_voice() == 1, "брошенная умершим процессом — снова в очереди"


async def test_voice_is_refused_to_designer_and_for_non_audio(client) -> None:
    ref = await reference(client)
    assert (await speak(client, ref, who=IVANOVA)).status_code == 403, "замечания ставит редактор"
    assert (await speak(client, ref, kind="image/png")).status_code == 422
    assert (await speak(client, ref, audio=b"")).status_code == 422

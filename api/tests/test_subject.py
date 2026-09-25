"""Сервис знает, кто пришёл (US-0486).

Токен выпускает платформа, сервис его только читает — ключами ядра и с
аудиторией «reference»: своего входа у приложения нет (запрет 3). Здесь ключи
подменяются своими, чтобы подписать токен в тесте; разбор — настоящий, пакета
платформы. Токен без аудитории «Референса», чужой подписи или без срока не
даёт субъекта вовсе — отказ на маршруте делает объявление права (US-0487).
"""

import datetime

import httpx
import jwt
import pytest_asyncio
from cryptography.hazmat.primitives.asymmetric import rsa
from platform_client.tokens import KeySet

from reference_api.app import create_app

KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
FOREIGN = rsa.generate_private_key(public_exponent=65537, key_size=2048)


class FixedKeys:
    def current(self) -> KeySet:
        return KeySet(by_key_id={"t1": KEY.public_key()})


def token(sub: str = "01OWNER", aud: str = "reference", key=KEY) -> str:
    now = datetime.datetime.now(datetime.UTC)
    claims = {"sub": sub, "aud": aud, "exp": now + datetime.timedelta(minutes=5),
              "org": "01ORG", "vis": "own", "grants": ["references:write"]}
    return jwt.encode(claims, key, algorithm="RS256", headers={"kid": "t1"})


@pytest_asyncio.fixture
async def client():
    from sqlalchemy import text

    from reference_api.db import engine

    app = create_app()
    app.state.keys = FixedKeys()
    async with app.router.lifespan_context(app):
        async with engine.begin() as conn:
            await conn.execute(text("truncate table reference_cards cascade"))
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://stand") as c:
            yield c
    await engine.dispose()


async def save_as(client, bearer: str | None) -> dict:
    headers = {"Authorization": f"Bearer {bearer}"} if bearer else {}
    r = await client.post("/reference/api/references", headers=headers,
                          json={"name": "проба", "sheet_digest": "a" * 64, "image_digests": [], "texts": []})
    assert r.status_code == 200, r.text
    cards = (await client.get("/reference/api/references")).json()
    return next(c for c in cards if c["id"] == r.json()["id"])


async def test_saved_card_knows_who_saved_it(client) -> None:
    assert (await save_as(client, token()))["author_id"] == "01OWNER"


async def test_token_of_another_application_gives_nobody(client) -> None:
    """Аудитория — код приложения: токен, выданный под plm, здесь не пропуск."""
    assert (await save_as(client, token(aud="plm")))["author_id"] is None


async def test_token_signed_not_by_the_platform_gives_nobody(client) -> None:
    assert (await save_as(client, token(key=FOREIGN)))["author_id"] is None


async def test_no_token_gives_nobody(client) -> None:
    assert (await save_as(client, None))["author_id"] is None

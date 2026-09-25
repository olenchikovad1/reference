"""Каждый изменяющий маршрут объявляет право (US-0487, инвариант И-4).

Права приезжают грантами в токене платформы; проверку делает объявление на
маршруте из пакета платформы — одно место и объявляет, и проверяет. Нет права —
«нет такого пути», а не «запрещено». Маршрут без объявления сервис не пускает
подняться. Стенд без платформы (решение 0006) — явной настройкой: тогда запрос
без токена получает стендового субъекта со всеми грантами манифеста.
"""

import datetime

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import APIRouter
from fastapi.testclient import TestClient
from platform_client import RightDeclarationError, verify_right_declarations
from platform_client.tokens import KeySet

from reference_api.app import create_app

KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
CARD = {"name": "проба", "sheet_digest": "b" * 64, "image_digests": [], "texts": []}


class FixedKeys:
    def current(self) -> KeySet:
        return KeySet(by_key_id={"t1": KEY.public_key()})


def bearer(*grants: str) -> dict[str, str]:
    now = datetime.datetime.now(datetime.UTC)
    claims = {"sub": "01SOMEONE", "aud": "reference", "exp": now + datetime.timedelta(minutes=5),
              "org": "01ORG", "vis": "own", "grants": list(grants)}
    return {"Authorization": "Bearer " + jwt.encode(claims, KEY, algorithm="RS256", headers={"kid": "t1"})}


@pytest.fixture
def platform_client() -> TestClient:
    app = create_app(without_platform=False)
    app.state.keys = FixedKeys()
    return TestClient(app)


async def _save(without_platform: bool, headers: dict[str, str]) -> int:
    """Сохранение с настоящей базой — асинхронным клиентом, как во всех
    тестах с базой: синхронный TestClient держит пул в чужом цикле событий."""
    from reference_api.db import engine

    app = create_app(without_platform=without_platform)
    app.state.keys = FixedKeys()
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://stand") as c:
            r = await c.post("/reference/api/references", json=CARD, headers=headers)
    await engine.dispose()
    return r.status_code


async def test_designer_with_write_saves() -> None:
    assert await _save(False, bearer("references:write")) == 200


def test_view_only_cannot_save_by_a_direct_request(platform_client: TestClient) -> None:
    """Мимо интерфейса тоже нельзя: ответ — «нет такого пути»."""
    r = platform_client.post("/reference/api/references", json=CARD, headers=bearer("references:view"))
    assert r.status_code == 404


def test_no_token_through_platform_is_refused(platform_client: TestClient) -> None:
    assert platform_client.post("/reference/api/references", json=CARD).status_code == 404


def test_upload_needs_write_on_prints(platform_client: TestClient) -> None:
    files = [("files", ("p.png", b"\x89PNG\r\n\x1a\n", "image/png"))]
    assert platform_client.post("/reference/api/assets", files=files, headers=bearer("references:write")).status_code == 404


def test_health_and_manifest_need_no_right(platform_client: TestClient) -> None:
    assert platform_client.get("/reference/api/health/live").status_code == 200
    assert platform_client.get("/reference/api/manifest").status_code == 200


async def test_stand_without_platform_works_without_token() -> None:
    assert await _save(True, {}) == 200


def test_every_changing_route_is_declared() -> None:
    declared = {f"{r.section}:{r.name}" for r in verify_right_declarations(create_app(without_platform=False))}
    assert {"references:write", "prints:write"} <= declared


def test_undeclared_changing_route_stops_the_service() -> None:
    app = create_app(without_platform=False)
    stray = APIRouter()

    @stray.post("/reference/api/stray")
    async def stray_route() -> None:
        return None

    app.include_router(stray)
    with pytest.raises(RightDeclarationError) as refusal:
        verify_right_declarations(app)
    assert "/reference/api/stray" in str(refusal.value)

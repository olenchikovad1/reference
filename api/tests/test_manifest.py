"""Самоописание для платформы: отдаётся по контракту и публикуется само (US-0484).

Ядро читает манифест по адресу приложения + /manifest — при регистрации и при
проверке «отвечает ли». А публикует его приложение само, при старте, своим
удостоверением: руками описание не переносит никто. Без удостоверения или при
отказе ядра сервис говорит, почему не опубликовался, и продолжает работать.
"""

import json

import httpx
import pytest
from fastapi.testclient import TestClient

from reference_api.app import create_app
from reference_api.services import platform as publishing


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(create_app())


def test_manifest_is_served_as_the_platform_reads_it(client: TestClient) -> None:
    r = client.get("/reference/api/manifest")
    assert r.status_code == 200
    m = r.json()
    assert m["code"] == "reference" and m["contract"] == "1"
    assert [s["code"] for s in m["sections"]] == [
        "references", "prints", "texts", "products", "drops", "review", "dictionaries", "archive"]


def _core(status: int, body: dict) -> httpx.MockTransport:
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers.get("authorization")
        seen["url"] = str(request.url)
        seen["body"] = json.loads(request.content)
        return httpx.Response(status, json=body)

    transport = httpx.MockTransport(handler)
    transport.seen = seen  # type: ignore[attr-defined]
    return transport


async def test_publication_puts_the_manifest_with_the_credential() -> None:
    core = _core(200, {"sections": ["references"], "published_at": "2026-09-25T10:00:00Z", "orphaned": []})
    result = await publishing.publish("http://core:8000", "pfc_secret", transport=core)
    assert result.published and "опубликован" in result.message
    assert core.seen["auth"] == "Bearer pfc_secret"
    assert core.seen["url"] == "http://core:8000/applications/reference/manifest"
    assert core.seen["body"]["code"] == "reference"


async def test_no_credential_says_why_and_does_not_call() -> None:
    result = await publishing.publish("http://core:8000", None)
    assert not result.published and "удостоверени" in result.message


async def test_wrong_credential_is_named_not_swallowed() -> None:
    result = await publishing.publish("http://core:8000", "pfc_bad", transport=_core(404, {"detail": "Not Found"}))
    assert not result.published and "удостоверение не подошло" in result.message


async def test_removed_section_with_holders_is_reported() -> None:
    """Раздел, убранный из описания, не уносит права молча."""
    core = _core(200, {"sections": [], "published_at": "2026-09-25T10:00:00Z",
                       "orphaned": [{"section": "library", "holders": 3}]})
    result = await publishing.publish("http://core:8000", "pfc_secret", transport=core)
    assert result.published and "library" in result.message and "3" in result.message

"""Платформа: самоописание приложения и его публикация (план 072, US-0484).

Манифест лежит одним файлом в корне репозитория (`manifest.reference.yaml`) и
отдаётся как есть — второго описания в коде нет, иначе они разойдутся.
Публикует его само приложение при старте, своим удостоверением `pfc_…`:
руками описание в платформу не переносит никто. Библиотеки для публикации у
платформы нет (её `platform_client` публикацию только упоминает), поэтому
запрос — здесь, по контракту ядра: PUT /applications/{код}/manifest.
"""

import pathlib
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

import httpx
import yaml

from reference_api.config import settings

#: Сколько ждать ядро. Публикация идёт в фоне и подъём сервиса не держит, но
#: зависший запрос не должен висеть вечно.
TIMEOUT_SECONDS = 10.0


@lru_cache
def manifest() -> dict[str, Any]:
    """Манифест из файла. Читается один раз на процесс: меняется он только с
    выкладкой, и перечитывать его на каждый запрос ядра незачем."""
    return yaml.safe_load(pathlib.Path(settings().manifest_path).read_text(encoding="utf-8"))


@dataclass(frozen=True)
class Publication:
    published: bool
    #: Для журнала старта: почему не опубликовался или что ответило ядро.
    message: str


async def publish(
    core_url: str | None, credential: str | None, transport: httpx.AsyncBaseTransport | None = None
) -> Publication:
    """Публикует манифест. Никогда не бросает: не опубликовался — сервис всё
    равно работает, а причина уходит в журнал старта."""
    if not credential:
        return Publication(False, "не опубликован: нет удостоверения PLATFORM_CREDENTIAL — приложение "
                                  "не зарегистрировано в платформе или ключ не положен в api/.env")
    if not core_url:
        return Publication(False, "не опубликован: не задан PLATFORM_CORE_URL")
    body = manifest()
    url = f"{core_url.rstrip('/')}/applications/{body['code']}/manifest"
    try:
        async with httpx.AsyncClient(transport=transport, timeout=TIMEOUT_SECONDS) as client:
            r = await client.put(url, json=body, headers={"Authorization": f"Bearer {credential}"})
    except httpx.HTTPError as failure:
        return Publication(False, f"не опубликован: ядро {core_url} не ответило — {type(failure).__name__}")
    if r.status_code == httpx.codes.NOT_FOUND:
        # Ядро отвечает 404 и на чужое удостоверение, и на незаведённое
        # приложение — так оно не раскрывает, какие приложения существуют.
        return Publication(False, "не опубликован: удостоверение не подошло или приложение не заведено в реестре")
    if r.status_code != httpx.codes.OK:
        return Publication(False, f"не опубликован: ядро ответило {r.status_code} — {r.text[:300]}")
    answer = r.json()
    orphaned = answer.get("orphaned") or []
    note = "; ".join(f"раздел {o['section']} убран, у {o['holders']} человек на нём были права" for o in orphaned)
    return Publication(True, f"опубликован {answer.get('published_at')}, разделов {len(answer.get('sections', []))}"
                             + (f"; ВНИМАНИЕ: {note}" if note else ""))

"""Колокол платформы: задача прилетела (план 075, US-0513).

«Пришло на согласование» — всем редакторам и главным, «вернули на
доработку» — исполнителю. Отправка — `POST <уведомления>/send` поимённо
(решение платформы 0030), от имени приложения: токен по удостоверению
подключения (`OwnTokens`, её решение 0029), человека за сигналом нет.

Шлётся в фоне и сбой только пишется в журнал: статус уже записан, и из-за
колокола шаг согласования не должен ни ждать, ни падать. Звонит только смена
статуса — сохранение версии сюда не приходит вовсе. Склейку повторов делает
сама платформа по `occasion`.

Чего платформа не умеет: погасить уведомление у остальных, когда один
редактор уже принял. Отзыва по `occasion` у неё нет — открытый вопрос плана.
"""

import asyncio
import logging

import httpx
from platform_client import OwnTokens

from reference_api.config import settings

log = logging.getLogger("reference.bell")

TIMEOUT_SECONDS = 5.0
#: Предел поимённых получателей у платформы.
MAX_RECIPIENTS = 200

_tokens: OwnTokens | None = None
#: Отправки в полёте: задача без ссылки на неё собирается сборщиком мусора.
_flying: set[asyncio.Task] = set()


def ring(recipients: list[str], occasion: str, subject: str, body: str, link: str) -> None:
    """Позвонить в фоне. Никого — не звонит."""
    people = sorted({r for r in recipients if r})[:MAX_RECIPIENTS]
    if not people:
        return
    payload = {"recipients": people, "occasion": occasion, "subject": subject, "body": body, "link": link}
    task = asyncio.create_task(deliver(payload))
    _flying.add(task)
    task.add_done_callback(_flying.discard)


async def drain() -> None:
    """Дождаться отправок в полёте — для тестов и остановки."""
    if _flying:
        await asyncio.gather(*_flying, return_exceptions=True)


async def deliver(payload: dict) -> None:
    global _tokens
    cfg = settings()
    if not (cfg.platform_credential and cfg.platform_core_url and cfg.platform_notifications_url):
        log.info("колокол: не настроен, «%s» не отправлено (%d)", payload["subject"], len(payload["recipients"]))
        return
    try:
        if _tokens is None:
            _tokens = OwnTokens(core_url=cfg.platform_core_url, application=cfg.platform_app_code,
                                credential=cfg.platform_credential)
        token = await _tokens.token_for(target="notifications", caller="согласование")
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as http:
            answer = await http.post(f"{cfg.platform_notifications_url.rstrip('/')}/send", json=payload,
                                     headers={"Authorization": f"Bearer {token}"})
        if answer.status_code >= 400:
            log.warning("колокол не принял «%s»: HTTP %s %s", payload["subject"], answer.status_code, answer.text[:200])
        else:
            log.info("колокол: «%s» — %s", payload["subject"], answer.json())
    except Exception:  # сеть, ядро, токен — шаг согласования от этого не падает
        log.exception("колокол недоступен, «%s» не отправлено", payload["subject"])

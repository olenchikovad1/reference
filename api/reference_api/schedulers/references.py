"""Референсы: очистка корзины по сроку (US-0494, решение 0014).

Слой: schedulers — транспорт, как api: переводит «пора» в вызов сервиса и
правил не содержит. Срок и частота — в настройках.
"""

import asyncio
import logging

from reference_api.config import settings
from reference_api.db import session_factory
from reference_api.services import references

log = logging.getLogger("reference.trash")


async def purge_expired() -> None:
    cfg = settings()
    while True:
        try:
            async with session_factory() as db:
                erased = await references.purge_expired(db)
            if erased:
                log.info("корзина: стёрто по сроку %s", erased)
        except Exception:  # noqa: BLE001 — сбой одного прохода не должен остановить очистку навсегда
            log.exception("корзина: проход очистки не удался, повторю через %s с", cfg.trash_check_seconds)
        await asyncio.sleep(cfg.trash_check_seconds)

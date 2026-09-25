"""Люди приложения: перечитывание снимка по расписанию (план 072, US-0508).

Слой: schedulers — транспорт, как api: переводит «пора» в вызов сервиса и
правил не содержит. Событий о смене прав ядро платформы не публикует (брокера
в её составе нет), поэтому раз в несколько минут: роль, назначенную в
платформе, «Референс» видит через это время без правки приложения.
"""

import asyncio

from reference_api.config import settings
from reference_api.db import session_factory
from reference_api.services import people


async def keep_fresh() -> None:
    cfg = settings()
    while True:
        async with session_factory() as db:
            await people.refresh(db, cfg.platform_core_url, cfg.platform_credential)
        await asyncio.sleep(cfg.people_refresh_seconds)

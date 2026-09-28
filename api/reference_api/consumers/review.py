"""Согласование: расшифровка голосовых замечаний (US-0512, решение 0017).

Слой: consumers. Разбор сообщений из брокера. Транспорт, как и api.
Вход из брокера. Право проверено при постановке задачи, не здесь.
"""

import asyncio

from reference_api import broker
from reference_api.services import review


async def _handle(body: dict) -> None:
    remark_id = int(body["remark_id"])
    outcome, attempts = await review.hear(remark_id)
    if outcome == "retry":
        # Пауза растёт: 2, 4 с — сбой среды за секунду не проходит.
        await asyncio.sleep(2 ** attempts)
        await broker.publish(review.VOICE_QUEUE, {"remark_id": remark_id})


async def run() -> None:
    """Недошедшие — снова в очередь, затем разбор. Одна расшифровка за раз
    (prefetch 1): модель держит бюджет памяти одной расшифровкой."""
    await review.resume_voice()
    await broker.consume(review.VOICE_QUEUE, _handle, prefetch=1)

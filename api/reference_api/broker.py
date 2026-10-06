"""Брокер сообщений: постановка задачи и разбор очереди (решение 0017).

Одно место для aio-pika: сервисы ставят задачу `publish`, входы `consumers/`
разбирают очередь `consume`. Нет адреса брокера (тесты) или он недоступен —
`publish` отвечает False и не бросает: задача, у которой состояние лежит в
базе, подбирается при старте, а человек не получает отказ из-за очереди.
"""

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable

import aio_pika

from reference_api.config import settings

log = logging.getLogger("reference.broker")

_connection: aio_pika.abc.AbstractRobustConnection | None = None
_channel: aio_pika.abc.AbstractChannel | None = None
_declared: set[str] = set()


async def _open() -> aio_pika.abc.AbstractChannel:
    global _connection, _channel
    if _connection is None or _connection.is_closed:
        _connection = await aio_pika.connect_robust(settings().amqp_url, timeout=5)
        _channel = None
        _declared.clear()
    if _channel is None or _channel.is_closed:
        _channel = await _connection.channel()
    return _channel


async def publish(queue: str, body: dict) -> bool:
    if not settings().amqp_url:
        return False
    try:
        channel = await _open()
        if queue not in _declared:
            await channel.declare_queue(queue, durable=True)
            _declared.add(queue)
        message = aio_pika.Message(json.dumps(body).encode(), delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
                                   content_type="application/json")
        await channel.default_exchange.publish(message, routing_key=queue)
        return True
    except Exception as e:  # noqa: BLE001 — брокер лёг — задача подберётся при старте
        log.warning("в очередь %s не поставлено: %s", queue, e)
        return False


async def consume(queue: str, handler: Callable[[dict], Awaitable[None]], prefetch: int = 1) -> None:
    """Разбирать очередь, пока сервис жив. Подтверждение — после handler:
    умерший на полпути процесс вернёт сообщение в очередь. Брокер недоступен
    — повтор подключения через 5 с, без конца: это не задача, а вход."""
    while True:
        try:
            connection = await aio_pika.connect_robust(settings().amqp_url, timeout=5)
            async with connection:
                channel = await connection.channel()
                await channel.set_qos(prefetch_count=prefetch)
                q = await channel.declare_queue(queue, durable=True)
                log.info("очередь %s: разбор начат", queue)
                async with q.iterator() as messages:
                    async for message in messages:
                        async with message.process(requeue=True):
                            await handler(json.loads(message.body))
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001 — обрыв связи любого вида лечится одним: переподключиться
            log.warning("очередь %s: %s — подключаюсь снова через 5 с", queue, e)
            await asyncio.sleep(5)

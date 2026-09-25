"""Люди приложения: снимок из платформы (план 072, US-0508).

Роли назначают в платформе — наборы прав «Дизайнер», «Редактор»,
«Суперредактор», «Технолог»; приложение их не выдаёт (запрет 3), а знает по
снимку. Путь платформы — её решение 0025: GET /applications/{код}/people с
удостоверением приложения, весь снимок сразу. Событий ядро не публикует, поэтому
снимок перечитывается по расписанию (schedulers/people.py).
"""

import logging

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.config import settings
from reference_api.models.people import Person
from reference_api.repositories import people as repo

log = logging.getLogger("reference.people")

TIMEOUT_SECONDS = 10.0


async def refresh(
    db: AsyncSession, core_url: str | None, credential: str | None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> bool:
    """Перечитать снимок. Удалось — True. Отказ, сетевая ошибка, нет ключа —
    False, и ПРЕЖНИЙ снимок остаётся: платформа ненадолго недоступна, а выбор
    исполнителя работать обязан. Неудача видна в журнале."""
    if not (core_url and credential):
        log.warning("люди не перечитаны: нет PLATFORM_CORE_URL или PLATFORM_CREDENTIAL")
        return False
    url = f"{core_url.rstrip('/')}/applications/{settings().platform_app_code}/people"
    try:
        async with httpx.AsyncClient(transport=transport, timeout=TIMEOUT_SECONDS) as client:
            r = await client.get(url, headers={"Authorization": f"Bearer {credential}"})
    except httpx.HTTPError as failure:
        log.warning("люди не перечитаны: ядро не ответило — %s; снимок прежний", type(failure).__name__)
        return False
    if r.status_code != httpx.codes.OK:
        # 404 — на всё: нет ключа, чужой, отозванный, приложение не заведено.
        log.warning("люди не перечитаны: ядро ответило %s; снимок прежний", r.status_code)
        return False
    # Поля ответа могут добавиться (договор платформы) — берём только свои.
    rows = [{k: p.get(k) for k in ("id", "display_name", "kind", "organization_id", "right_sets")}
            for p in r.json().get("people", [])]
    await repo.replace(db, rows)
    log.info("люди перечитаны: %d", len(rows))
    return True


async def listing(db: AsyncSession, right_set: str | None = None) -> list[Person]:
    """Кто сейчас с доступом — для выбора исполнителя и согласующих."""
    return await repo.listing(db, right_set)


async def names_of(db: AsyncSession, ids: list[str]) -> dict[str, str]:
    """Имена для показа «кто сделал» — в том числе тех, у кого доступ забрали."""
    return await repo.names(db, sorted({i for i in ids if i}))


async def name_of(db: AsyncSession, subject_id: str) -> str | None:
    return (await names_of(db, [subject_id])).get(subject_id)

"""Сборка приложения FastAPI.

Все маршруты живут под префиксом приложения, а не в корне: первый сегмент пути
принадлежит коду приложения в платформе, и занимать что-либо вне его нельзя.
"""

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI, Request
from platform_client import verify_right_declarations
from platform_client.subjects import install_subject_reading
from platform_client.tokens import KeySet, Subject, Visibility
from starlette.middleware.base import BaseHTTPMiddleware

from reference_api.api import assets, colours, drops, health, library, people, platform, prints, products, references
from reference_api.config import settings
from reference_api.schedulers import people as people_schedule
from reference_api.schedulers import references as trash_schedule
from reference_api.services import platform as publishing

log = logging.getLogger("reference.platform")


async def _publish() -> None:
    cfg = settings()
    result = await publishing.publish(cfg.platform_core_url, cfg.platform_credential)
    (log.info if result.published else log.warning)("манифест %s", result.message)


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Публикация в фоне: недоступное ядро не должно держать подъём сервиса, а
    # стенд без платформы (решение 0006) поднимается вовсе без неё.
    tasks = [asyncio.create_task(_publish())]
    cfg = settings()
    # Ключи ядра для токенов. Тест подставляет свои заранее — их не трогаем.
    if getattr(app.state, "keys", None) is None and cfg.platform_jwks_url:
        app.state.keys = publishing.PlatformKeys(cfg.platform_jwks_url)
        tasks.append(asyncio.create_task(app.state.keys.keep_fresh()))
    # Люди приложения — только когда есть чем спросить платформу; у стенда без
    # неё и в тестах снимок перечитывается вручную.
    if cfg.platform_credential and cfg.platform_core_url and not cfg.without_platform:
        tasks.append(asyncio.create_task(people_schedule.keep_fresh()))
    # Корзина чистится по сроку всегда: срок — обещание человеку, а не
    # свойство стенда с платформой.
    tasks.append(asyncio.create_task(trash_schedule.purge_expired()))
    yield
    for task in tasks:
        task.cancel()


def _stand_subject() -> Subject:
    """Стендовый субъект: все гранты манифеста — каждое действие каждого
    раздела и каждая функция. Только для стенда без платформы."""
    m = publishing.manifest()
    granted = {f"{s['code']}:{a}" for s in m["sections"] for a in s.get("actions", ("view", "write", "delete"))}
    granted |= {f"{s['code']}:{f['code']}" for s in m["sections"] for f in s.get("functions", ())}
    return Subject(id="stand", organization_id="", visibility=Visibility.ALL, granted=frozenset(granted))


class _StandSubject(BaseHTTPMiddleware):
    """Запрос без субъекта получает стендового. Стоит ВНУТРИ посредника
    платформы: сначала тот разбирает токен, потом пустое место заполняется."""

    async def dispatch(self, request: Request, call_next):  # type: ignore[no-untyped-def]
        if getattr(request.state, "subject", None) is None:
            request.state.subject = _stand_subject()
        return await call_next(request)


def _current_keys(app: FastAPI) -> KeySet:
    """Ключи на каждый запрос: посредник ставится при сборке, а ключи приходят
    от ядра позже, в lifespan. Нет их — не принимается ни один токен."""
    keys = getattr(app.state, "keys", None)
    return keys.current() if keys is not None else KeySet(by_key_id={})


def create_app(without_platform: bool | None = None) -> FastAPI:
    """Собирает приложение. Отдельной функцией — чтобы тест поднимал своё;
    режим стенда без платформы тест может задать явно."""
    cfg = settings()
    stand = cfg.without_platform if without_platform is None else without_platform
    # Журнал приложения. Uvicorn настраивает только свои журналы, и без этой
    # строки всё уровня INFO из reference.* пропадало: настройка log_level
    # была, а не действовала (25.09.2026).
    if not logging.getLogger().handlers:
        logging.basicConfig(level=cfg.log_level, format="%(levelname)s %(name)s: %(message)s")
    app = FastAPI(
        title="Референс",
        docs_url=cfg.base_path + "/docs",
        openapi_url=cfg.base_path + "/openapi.json",
        lifespan=_lifespan,
    )

    root = APIRouter(prefix=cfg.base_path)
    root.include_router(health.router)
    root.include_router(platform.router)
    root.include_router(products.router)
    root.include_router(colours.router)
    root.include_router(prints.router)
    root.include_router(assets.router)
    root.include_router(references.router)
    root.include_router(people.router)
    root.include_router(drops.router)
    root.include_router(library.router)
    app.include_router(root)
    if stand:
        # Добавлен раньше посредника платформы — значит, исполняется после него.
        app.add_middleware(_StandSubject)
        log.warning("СТЕНД БЕЗ ПЛАТФОРМЫ: запрос без токена получает все гранты манифеста")
    # Кто пришёл — из токена платформы, аудитория — код приложения: токен под
    # «Референс» выдаётся только тому, у кого к нему доступ (US-0486).
    install_subject_reading(app, keys=lambda: _current_keys(app), audience=cfg.platform_app_code)
    # Изменяющий маршрут без объявленного права — сервис не поднимается и
    # называет все такие маршруты сразу (И-4, US-0487).
    verify_right_declarations(app)
    return app


app = create_app()

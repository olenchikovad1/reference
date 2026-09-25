"""Сборка приложения FastAPI.

Все маршруты живут под префиксом приложения, а не в корне: первый сегмент пути
принадлежит коду приложения в платформе, и занимать что-либо вне его нельзя.
"""

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI

from reference_api.api import assets, colours, health, platform, prints, products, references
from reference_api.config import settings
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
    task = asyncio.create_task(_publish())
    yield
    task.cancel()


def create_app() -> FastAPI:
    """Собирает приложение. Отдельной функцией — чтобы тест поднимал своё."""
    cfg = settings()
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
    app.include_router(root)
    return app


app = create_app()

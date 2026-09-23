"""Сборка приложения FastAPI.

Все маршруты живут под префиксом приложения, а не в корне: первый сегмент пути
принадлежит коду приложения в платформе, и занимать что-либо вне его нельзя.
"""

from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI

from reference_api.api import assets, colours, health, prints, products
from reference_api.config import settings


@asynccontextmanager
async def _lifespan(app: FastAPI):
    """Схема поднимается при старте.

    Настоящие миграции придут с первой историей, где появится модель данных
    шире одной таблицы. Делать их сейчас — раскладывать инструмент под работу,
    которой ещё нет.
    """
    from reference_api.repositories.library import ensure_schema

    await ensure_schema()
    yield


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
    root.include_router(products.router)
    root.include_router(colours.router)
    root.include_router(prints.router)
    root.include_router(assets.router)
    app.include_router(root)
    return app


app = create_app()

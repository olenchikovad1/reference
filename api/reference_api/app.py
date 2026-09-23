"""Сборка приложения FastAPI.

Все маршруты живут под префиксом приложения, а не в корне: первый сегмент пути
принадлежит коду приложения в платформе, и занимать что-либо вне его нельзя.
"""

from fastapi import APIRouter, FastAPI

from reference_api.api import health, products
from reference_api.config import settings


def create_app() -> FastAPI:
    """Собирает приложение. Отдельной функцией — чтобы тест поднимал своё."""
    cfg = settings()
    app = FastAPI(
        title="Референс",
        docs_url=cfg.base_path + "/docs",
        openapi_url=cfg.base_path + "/openapi.json",
    )

    root = APIRouter(prefix=cfg.base_path)
    root.include_router(health.router)
    root.include_router(products.router)
    app.include_router(root)
    return app


app = create_app()

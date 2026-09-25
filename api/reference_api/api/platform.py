"""Платформа: самоописание приложения — вход по HTTP."""

from typing import Any

from fastapi import APIRouter

from reference_api.services import platform

router = APIRouter(tags=["platform"])


@router.get("/manifest")
def manifest() -> dict[str, Any]:
    """Манифест по контракту платформы. Ядро читает его по адресу приложения +
    /manifest (регистрация, проверка «отвечает ли»); Vite проксирует туда
    корневой /manifest — прав маршрут не требует, это обязательство перед ядром."""
    return platform.manifest()

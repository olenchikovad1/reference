"""Каталог PLM наружу — транспорт (US-0883, US-0886).

Правил предметной области нет: сервисный слой зовёт plm, ответы не
материализуются в справочники Reference (решение 0018).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from reference_api.config import settings
from reference_api.services import plm as plm_service

__all__ = ["router"]

router = APIRouter(prefix="/plm", tags=["plm"])


def _configured() -> tuple[str, str]:
    cfg = settings()
    if not cfg.plm_base_url or not cfg.plm_machine_key:
        raise HTTPException(
            status_code=503,
            detail={"code": "plm_unset", "message": "Чтение plm не настроено (нет адреса или ключа)."},
        )
    return cfg.plm_base_url, cfg.plm_machine_key


def _map_failure(exc: Exception) -> HTTPException:
    if isinstance(exc, plm_service.PlmUnavailable):
        return HTTPException(
            status_code=503,
            detail={"code": "plm_unavailable", "message": str(exc)},
        )
    if isinstance(exc, plm_service.PlmRefused):
        return HTTPException(
            status_code=502,
            detail={"code": "plm_refused", "message": str(exc)},
        )
    return HTTPException(status_code=500, detail={"code": "plm_error", "message": str(exc)})


@router.get("/status")
async def status() -> dict[str, Any]:
    """Настроен ли канал и отвечает ли plm на чтение дропов."""
    cfg = settings()
    if not cfg.plm_base_url or not cfg.plm_machine_key:
        return {"configured": False, "reachable": False, "drops": 0, "message": "plm не настроен"}
    try:
        items = await plm_service.list_drops(cfg.plm_base_url, cfg.plm_machine_key)
    except (plm_service.PlmUnavailable, plm_service.PlmRefused) as failure:
        return {"configured": True, "reachable": False, "drops": 0, "message": str(failure)}
    return {"configured": True, "reachable": True, "drops": len(items), "message": "ok"}


@router.get("/drops")
async def drops(active_only: bool = True) -> dict[str, Any]:
    base, key = _configured()
    try:
        items = await plm_service.list_drops(base, key, active_only=active_only)
    except (plm_service.PlmUnavailable, plm_service.PlmRefused) as failure:
        raise _map_failure(failure) from failure
    return {
        "items": [
            {
                "code": d.code,
                "season": d.season,
                "subseason": d.subseason,
                "category": d.category,
                "description": d.description,
                "ship_week_uz": d.ship_week_uz,
                "ship_week_cn": d.ship_week_cn,
                "intake_week": d.intake_week,
                "exit_week": d.exit_week,
                "active": d.active,
                "position": d.position,
            }
            for d in items
        ]
    }


@router.get("/colorways")
async def colorways(drop: str | None = Query(default=None)) -> dict[str, Any]:
    base, key = _configured()
    try:
        items = await plm_service.list_colorways(base, key, drop=drop)
    except (plm_service.PlmUnavailable, plm_service.PlmRefused) as failure:
        raise _map_failure(failure) from failure
    return {
        "items": [
            {
                "id": c.id,
                "article": c.article,
                "title": c.title,
                "style_id": c.style_id,
                "style_code": c.style_code,
                "color": c.color,
                "base_color": c.base_color,
                "rgb": list(c.rgb) if c.rgb else None,
                "gender": c.gender,
                "image": c.image,
                "suppliers": list(c.suppliers),
            }
            for c in items
        ]
    }


@router.get("/colors")
async def colors() -> dict[str, Any]:
    base, key = _configured()
    try:
        items = await plm_service.list_colors(base, key)
    except (plm_service.PlmUnavailable, plm_service.PlmRefused) as failure:
        raise _map_failure(failure) from failure
    return {
        "items": [
            {
                "id": c.id,
                "code": c.code,
                "code_short": c.code_short,
                "name": c.name,
                "name_ru": c.name_ru,
                "red": c.red,
                "green": c.green,
                "blue": c.blue,
            }
            for c in items
        ]
    }


@router.get("/colorways/{colorway_id}")
async def colorway(colorway_id: str) -> dict[str, Any]:
    base, key = _configured()
    try:
        return await plm_service.colorway_card(base, key, colorway_id)
    except (plm_service.PlmUnavailable, plm_service.PlmRefused) as failure:
        raise _map_failure(failure) from failure

"""Цвета: вход по HTTP."""

from fastapi import APIRouter, HTTPException

from reference_api.schemas.colours import Palette
from reference_api.services import colours as service
from reference_api.services import plm

router = APIRouter(prefix="/colours", tags=["colours"])


@router.get("", response_model=Palette)
async def get_palette() -> Palette:
    """Палитра справочника: чем можно красить изделие и надписи."""
    try:
        return Palette.model_validate(await service.current_palette())
    except service.PaletteMissing as e:
        raise HTTPException(404, f"Палитра не найдена в томе описаний: {e}") from None
    except plm.PlmUnavailable:
        raise HTTPException(503, {"code": "plm_unavailable", "message": "Палитра PLM недоступна. Повторите позже."}) from None
    except plm.PlmRefused:
        raise HTTPException(502, {"code": "plm_refused", "message": "PLM не разрешил чтение палитры."}) from None

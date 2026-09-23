"""Цвета: вход по HTTP."""

from fastapi import APIRouter, HTTPException

from reference_api.schemas.colours import Palette
from reference_api.services import colours as service

router = APIRouter(prefix="/colours", tags=["colours"])


@router.get("", response_model=Palette)
def get_palette() -> Palette:
    """Палитра справочника: чем можно красить изделие и надписи."""
    try:
        return Palette.model_validate(service.palette())
    except service.PaletteMissing as e:
        raise HTTPException(404, f"Палитра не найдена в томе описаний: {e}") from None

"""Принты: вход по HTTP."""

from fastapi import APIRouter, HTTPException, Response

from reference_api.schemas.prints import Print
from reference_api.services import prints as service

router = APIRouter(prefix="/prints", tags=["prints"])


@router.get("", response_model=list[Print])
def list_prints() -> list[Print]:
    """Набор принтов: и настоящие, и эталонные, одним списком."""
    return [Print.model_validate(p) for p in service.catalogue()]


@router.get("/{path:path}")
def get_print(path: str) -> Response:
    """Байты принта из тома."""
    try:
        return Response(service.content(path), media_type="image/png")
    except service.PrintMissing:
        raise HTTPException(404, f"Принта {path} нет в наборе") from None

"""Изделия: контракт и вход по HTTP.

Транспорт. Правил предметной области здесь нет — только перевод отказов сервиса
в ответы и обратно.
"""

from fastapi import APIRouter, HTTPException, Response

from reference_api.schemas.products import Product
from reference_api.services import products as service

router = APIRouter(prefix="/products", tags=["products"])


@router.get("/{code}", response_model=Product)
def get_product(code: str) -> Product:
    """Описание изделия: состояния, ориентиры, зоны, калибровка."""
    try:
        return Product.model_validate(service.get(code))
    except service.ProductNotFound:
        raise HTTPException(404, f"Изделие {code} не описано") from None


@router.get("/{code}/states/{state}/frame")
def get_frame(code: str, state: str) -> Response:
    """Кадр состояния байтами PNG."""
    try:
        # Кадр меняется, только когда технолог заменит исходник, — час кэша
        # снимает повторную загрузку при каждом открытии окна.
        return Response(service.frame(code, state), media_type="image/png",
                        headers={"Cache-Control": "public, max-age=3600"})
    except service.ProductNotFound:
        raise HTTPException(404, f"Изделие {code} не описано") from None
    except service.StateNotFound:
        raise HTTPException(404, f"У изделия {code} нет состояния {state}") from None
    except service.FrameMissing as e:
        # Называем путь: на чистой машине том пуст, и человеку надо знать, какой
        # файл положить, а не идти читать код.
        raise HTTPException(404, f"Кадр состояния {state} не найден в томе: {e}") from None

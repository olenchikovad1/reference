"""Изделия: правила предметной области.

Здесь живёт единственное, что нельзя доверить ни транспорту, ни хранилищу:
что считать точным ракурсом, когда калибровка предварительна и чего не хватает,
если кадра нет на месте.
"""

from typing import Any

from reference_api.repositories import products as repo


class ProductNotFound(Exception):
    """Изделия с таким кодом нет. Ожидаемый отказ, не поломка."""


class StateNotFound(Exception):
    """У изделия нет такого состояния."""


class FrameMissing(Exception):
    """Состояние описано, но файла кадра в томе нет.

    Отдельно от StateNotFound: на чистой машине том пуст, и это штатный случай.
    Человеку надо сказать, какой файл положить и куда, — иначе он пойдёт читать
    код вместо того, чтобы скопировать файл.
    """


def get(code: str) -> dict[str, Any]:
    """Описание изделия целиком."""
    data = repo.load_product(code)
    if data is None:
        raise ProductNotFound(code)
    return data


def _state(data: dict[str, Any], state_code: str) -> dict[str, Any]:
    for state in data.get("states", []):
        if state.get("code") == state_code:
            return state
    raise StateNotFound(state_code)


def frame(code: str, state_code: str) -> bytes:
    """Байты кадра состояния."""
    data = get(code)
    state = _state(data, state_code)
    path = state["frame"]["path"]
    content = repo.read_frame(path)
    if content is None:
        raise FrameMissing(path)
    return content

"""Цвета: правила предметной области.

Правило здесь одно, но важное: цвет опознаётся кодом, а не оттенком. На фабрику
уходит код пантона; RGB существует только чтобы показать его на экране, и
обратной дороги от экрана к коду нет.
"""

from typing import Any

from reference_api.repositories import colours as repo


class PaletteMissing(Exception):
    """Файла палитры нет в томе. Штатный случай на чистой машине."""


def palette() -> dict[str, Any]:
    data = repo.load_palette()
    if data is None:
        raise PaletteMissing("palette.yaml")
    return data

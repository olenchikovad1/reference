"""Цвета: правила предметной области.

Правило здесь одно, но важное: цвет опознаётся кодом, а не оттенком. На фабрику
уходит код пантона; RGB существует только чтобы показать его на экране, и
обратной дороги от экрана к коду нет.
"""

from datetime import datetime, timezone
from typing import Any

from reference_api.config import settings
from reference_api.repositories import colours as repo
from reference_api.services import plm


class PaletteMissing(Exception):
    """Файла палитры нет в томе. Штатный случай на чистой машине."""


def palette() -> dict[str, Any]:
    """Палитра фикстур: только для локальных ассортиментных примеров."""
    data = repo.load_palette()
    if data is None:
        raise PaletteMissing("palette.yaml")
    return data


async def current_palette() -> dict[str, Any]:
    """Рабочие коды берутся из PLM; недоступность не подменяет справочник."""
    cfg = settings()
    if not cfg.plm_base_url and not cfg.plm_machine_key and cfg.without_platform:
        return palette()
    if not cfg.plm_base_url or not cfg.plm_machine_key:
        raise plm.PlmUnavailable("Чтение палитры PLM не настроено")
    colors = await plm.list_colors(cfg.plm_base_url, cfg.plm_machine_key)
    usable: dict[str, dict[str, Any]] = {}
    for color in colors:
        channels = (color.red, color.green, color.blue)
        if not color.code or any(channel is None or not 0 <= channel <= 255 for channel in channels):
            continue
        name = color.name_ru or color.name or color.code
        usable.setdefault(color.code, {
            "group": name, "code": color.code,
            "code_short": color.code_short or color.code,
            "name": name, "rgb": channels,
        })
    return {
        "source": "PLM", "exported": datetime.now(timezone.utc).date(),
        "colors": list(usable.values()),
    }

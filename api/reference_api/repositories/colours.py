"""Цвета: как достаётся палитра. Бизнес-смысла здесь нет.

Источник — том описаний, тот же, что у изделий. Позже им станет справочник
портала plm, куда переезжает Cosmic; форма записи у них совпадает, поэтому
смена источника не заденет ни схему, ни страницу.
"""

from pathlib import Path
from typing import Any

import yaml

from reference_api.config import settings


def load_palette() -> dict[str, Any] | None:
    """Палитра целиком. Нет файла — нет палитры, и это не поломка."""
    path = Path(settings().fixtures_path) / "palette.yaml"
    if not path.is_file():
        return None
    return yaml.safe_load(path.read_text(encoding="utf-8"))

"""Изделия: как данные достаются. Бизнес-смысла здесь нет.

Источник — не база, а два тома только для чтения: описания изделий и кадры.
Это осознанно: описание правит человек, перечитывается оно без пересборки, а
кадры весят столько, что в репозиторий их не кладут (решение 0002).
"""

from pathlib import Path
from typing import Any

import yaml

from reference_api.config import settings


def load_product(code: str) -> dict[str, Any] | None:
    """Описание изделия из тома фикстур. Нет файла — нет изделия."""
    path = Path(settings().fixtures_path) / f"{code}.yaml"
    if not path.is_file():
        return None
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def read_frame(relative_path: str) -> bytes | None:
    """Кадр состояния из тома файлового пространства.

    Путь приходит из описания изделия и складывается с корнем тома. Выход за
    его пределы отвергается: описание правят руками, и опечатка вида `../..`
    не должна открывать файловую систему сервиса.
    """
    root = Path(settings().files_volume_path).resolve()
    target = (root / relative_path).resolve()
    if root not in target.parents:
        return None
    if not target.is_file():
        return None
    return target.read_bytes()

"""Принты: как достаётся набор из тома.

Настоящие принты и эталонные лежат рядом и достаются одинаково — в этом смысл:
когда появятся новые настоящие, они добавятся тем же способом и ничем от
эталонных отличаться не будут.
"""

from pathlib import Path
from typing import Any

import yaml

from reference_api.config import settings

SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}


def _root() -> Path:
    return Path(settings().files_volume_path) / "prints"


def list_files() -> list[str]:
    """Пути принтов относительно корня набора, по алфавиту."""
    root = _root()
    if not root.is_dir():
        return []
    found = [p for p in root.rglob("*") if p.is_file() and p.suffix.lower() in SUFFIXES]
    return sorted(str(p.relative_to(root)).replace("\\", "/") for p in found)


def read(relative: str) -> bytes | None:
    """Байты принта. Выход за корень набора отвергается."""
    root = _root().resolve()
    target = (root / relative).resolve()
    if root not in target.parents or not target.is_file():
        return None
    return target.read_bytes()


def descriptions() -> dict[str, Any]:
    """Описания из фикстуры: чему каждый принт служит."""
    path = Path(settings().fixtures_path) / "prints.yaml"
    if not path.is_file():
        return {}
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}

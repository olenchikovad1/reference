"""Принты: правила предметной области.

Правило здесь одно: файл без описания всё равно попадает в набор. Иначе
принт, положенный в том руками, исчезает из интерфейса, и человек ищет
поломку там, где её нет.
"""

from typing import Any

from reference_api.repositories import prints as repo


class PrintMissing(Exception):
    """Такого принта в наборе нет."""


def catalogue() -> list[dict[str, Any]]:
    described = {d["name"]: d for d in repo.descriptions().get("files", [])}
    probes = {d["name"]: d for d in repo.descriptions().get("probes", [])}
    out: list[dict[str, Any]] = []
    for path in repo.list_files():
        name = path.rsplit("/", 1)[-1]
        meta = probes.get(name) or described.get(name) or {}
        out.append(
            {
                "path": path,
                "name": name,
                # Эталонные принты лежат в своей папке и помечены: они отвечают
                # на вопрос про печать, а не изображают коллекцию.
                "kind": "probe" if path.startswith("probes/") else "artwork",
                "subject": meta.get("subject"),
                "answers": meta.get("answers"),
                "width_cm": meta.get("width_cm"),
            }
        )
    return out


def content(path: str) -> bytes:
    data = repo.read(path)
    if data is None:
        raise PrintMissing(path)
    return data

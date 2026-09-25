"""Замер: похожесть всех пар набора владельца и три уровня узнавания (US-0431).

Ожидания записаны в `prints.yaml` ДО замера: тот же объект узнаётся, та же
категория — нет, чужое — тем более. Замер 23.09.2026 показал, что первое
порогом не отделяется (сцена весит больше машины), а чужое отделяется с
запасом. Уровень пары считается по подписям из описания набора, а не из кода:
поправка владельца 25.09.2026 (is3-summer — ИС-7) учитывается сама.

Где: контейнер api:

    docker compose -f infra/compose.yaml exec -T api python -m scripts.embeddings.pairs
"""

import itertools
import pathlib

import yaml

from reference_api.services import embeddings as e

FILES = pathlib.Path("/srv/reference/files/prints")
FIX = pathlib.Path("/srv/reference/fixtures")


def level(a: dict, b: dict) -> str:
    if a["subject"] == b["subject"]:
        return "тот же объект"
    return "та же категория" if a["category"] == b["category"] else "чужое"


def main() -> None:
    fixture = yaml.safe_load((FIX / "prints.yaml").read_text(encoding="utf-8"))
    prints = {f["name"]: f for f in fixture["files"]}
    vecs = {n: e.embed((FILES / n).read_bytes()).vector for n in prints}
    rows = sorted(((e.similarity(vecs[a], vecs[b]), level(prints[a], prints[b]), a, b)
                   for a, b in itertools.combinations(sorted(prints), 2)), reverse=True)
    for s, lvl, a, b in rows:
        print(f"  {s:.3f}  {lvl:16} {a:34} {b}")

    measured = fixture["measured"]
    by = {lvl: [s for s, l, _, _ in rows if l == lvl] for lvl in ("тот же объект", "та же категория", "чужое")}
    print("\nсверка с записанным 23.09.2026:")
    for lvl, key in (("чужое", "foreign_range"), ("та же категория", "tanks_range")):
        got = [round(min(by[lvl]), 3), round(max(by[lvl]), 3)] if by[lvl] else None
        print(f"  {lvl}: {got}, записано {measured.get(key)}"
              + ("" if lvl == "чужое" else " (в записи — «танки между собой», включая пары одного объекта)"))
    for s, lvl, a, b in rows:
        if lvl == "тот же объект":
            print(f"  тот же объект: {prints[a]['subject']} {s:.3f}")


if __name__ == "__main__":
    main()

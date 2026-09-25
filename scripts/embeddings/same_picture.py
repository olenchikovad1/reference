"""Замер: узнаётся ли та же картинка, изменённая так, что хеш её не видит (US-0431).

Ради этого случая вектор и нужен: картинку уменьшили, пересохранили из чата,
обрезали — хеш молчит, а это тот же принт. Замер 23.09.2026 на td-rusty дал
0.992…0.915 для пяти изменений и 0.896 для другого объекта — порог 0.91 между
ними (`prints.yaml`, `measured.same_picture_*`). Варианты делает
`scripts/prints/variants.py` с теми же параметрами.

Где: контейнер api:

    docker compose -f infra/compose.yaml exec -T api python -m scripts.embeddings.same_picture
"""

import hashlib
import pathlib

import yaml

from reference_api.services import embeddings as e
from scripts.prints.variants import VARIANTS, make

PRINTS = pathlib.Path("/srv/reference/files/prints")
FIX = pathlib.Path("/srv/reference/fixtures")
BASE = "td-rusty-print.png"
OTHER = "t72-winter-print.png"


def main() -> None:
    measured = yaml.safe_load((FIX / "prints.yaml").read_text(encoding="utf-8"))["measured"]
    recorded = {s["change"]: s["similarity"] for s in measured["same_picture_samples"]}
    src = (PRINTS / BASE).read_bytes()
    base = e.embed(src).vector
    cases = [(label, make(name, src)) for name, (label, _) in VARIANTS.items() if name != "from_chat"]
    cases.append(("другой объект — граница снизу", (PRINTS / OTHER).read_bytes()))
    threshold = measured["same_picture_threshold"]
    for label, data in cases:
        s = e.similarity(base, e.embed(data).vector)
        same_hash = hashlib.sha256(data).digest() == hashlib.sha256(src).digest()
        key = label.split(" (")[0]
        print(f"  {s:.3f}  записано {recorded.get(key, '—')!s:6} хеш совпал: {same_hash!s:5}  "
              f"{'выше' if s >= threshold else 'НИЖЕ'} порога {threshold}  {label}")


if __name__ == "__main__":
    main()

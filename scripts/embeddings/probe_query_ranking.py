"""Опыт US-0482/US-0480: находит ли запрос словом нужные картинки среди всех.

В тегах картинки «снег» проигрывает «танку» на той же картинке. В поиске он
соревнуется с другими картинками: снежный танк против надписи и белой худи.
Печатается порядок картинок по похожести на запрос.

    docker compose -f infra/compose.yaml exec -T api python -m scripts.embeddings.probe_query_ranking
"""

import pathlib
import sys

import numpy as np
import yaml

from reference_api.services import assets
from reference_api.services.embeddings import embed as embed_image
from reference_api.services import words

FILES = pathlib.Path("/srv/reference/files")
FIX = pathlib.Path("/srv/reference/fixtures")
prints = yaml.safe_load((FIX / "prints.yaml").read_text(encoding="utf-8"))["files"]

items = []
for f in prints:
    items.append((f["subject"], np.array(embed_image((FILES / "prints" / f["name"]).read_bytes()).vector, dtype=np.float32)))
for d in ["a7ccff40d80aef903585d44cb0c34e96aba00343b1171af11cf62a4a9e63aa32",
          "e3fb1fae2696c7e58d6d06b9d2bf49e7751aa6de5ebf432f87bea83a4dcd2bb7",
          "d84c590b7339cf09a5391ca2745899356d7b894c692a1449a13d6b18cb638277"]:
    c = assets.original(d)
    # Надписи живут в хранилище стенда (MinIO), а не в томе: на другой
    # машине их нет. Молча считать без них нельзя — числа выйдут другими
    # и сравнятся с записанными как ни в чём не бывало (25.09.2026).
    if not c:
        if "--partial" not in sys.argv:
            sys.exit(f"нет надписи {d[:12]}… в хранилище стенда: замер на неполном наборе "
                     f"с записанными числами не сравним. Считать без надписей — ключ --partial")
        print(f"# НЕПОЛНЫЙ НАБОР: нет надписи {d[:12]}…, с записанными числами не сравнивать")
    else:
        items.append((f"надпись {d[:4]}", np.array(embed_image(c).vector, dtype=np.float32)))
for code in ("front", "back"):
    items.append((f"худи {code}", np.array(embed_image((FILES / f"products/B-HDY-14/states/{code}.png").read_bytes()).vector,
                                          dtype=np.float32)))

M = np.stack([v for _, v in items])
for q in ["снег", "снежное", "зима", "лето", "вертолёт", "танк", "надпись", "огонь", "толстовка", "кот"]:
    s = M @ words.embed([q])[0]
    order = np.argsort(-s)
    print(f"«{q}»: " + ", ".join(f"{items[i][0]} {s[i]:.3f}" for i in order[:6]))

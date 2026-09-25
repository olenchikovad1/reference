"""Опыт US-0482: помогает ли центрирование против вездесущих слов.

Слова вроде «изображение», «катализатор», «славянин» стоят высоко на любой
картинке — это свойство пространства (hubness), а не картинки. Проверяется:
вычесть из векторов слов их среднее; вычесть ещё и среднее по картинкам.

    docker compose -f infra/compose.yaml exec -T api python -m scripts.embeddings.probe_words_centering
"""

import pathlib

import numpy as np
import yaml

from reference_api.services.embeddings import embed as embed_image
from reference_api.services import words

FILES = pathlib.Path("/srv/reference/files")
FIX = pathlib.Path("/srv/reference/fixtures")
prints = yaml.safe_load((FIX / "prints.yaml").read_text(encoding="utf-8"))["files"]
FORM = {"Танк": "танк", "Снег": "снег", "Зима": "зима", "Лес": "лес", "Горы": "гора",
        "Небо": "небо", "Вертолёт": "вертолет", "Огонь": "огонь", "Дым": "дым",
        "Камуфляж": "камуфляж", "Надпись": "надпись"}

cases = []
for f in prints:
    img = np.array(embed_image((FILES / "prints" / f["name"]).read_bytes()).vector, dtype=np.float32)
    cases.append((f["subject"], img, {FORM[t] for t in f["tags_expected"]}))
frame = np.array(embed_image((FILES / "products/B-HDY-14/states/front.png").read_bytes()).vector, dtype=np.float32)

vocab, W = words.vocabulary(10000, "{}")
imgs = np.stack([c[1] for c in cases] + [frame])


def norm(m):
    return m / np.linalg.norm(m, axis=-1, keepdims=True)


variants = {
    "как есть": (W, lambda x: x),
    "слова − среднее слов": (norm(W - W.mean(0)), lambda x: x),
    "слова и картинки − средние": (norm(W - W.mean(0)), lambda x: norm(x - imgs.mean(0))),
}
for name, (Wv, fix) in variants.items():
    in10 = in20 = 0
    tops = []
    for subj, img, exp in cases:
        s = Wv @ fix(img)
        top = [vocab[i] for i in np.argsort(-s)[:20]]
        in10 += len(exp & set(top[:10]))
        in20 += len(exp & set(top))
        tops.append((subj, top[:10]))
    print(f"\n{name}: в десятке {in10}, в двадцатке {in20} из 34")
    for subj, top in tops[:3] + tops[-1:]:
        print(f"   {subj:10} {', '.join(top)}")

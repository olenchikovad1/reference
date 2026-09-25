"""Замер: различает ли модель названия машин (US-0479).

Для каждого принта набора модель выбирает название из известных — тех, что
подписаны в каталоге. Считается, сколько угадано. Случайный выбор из пяти
танковых названий угадывает каждый пятый — с этим числом и сравнивать.

    docker compose -f infra/compose.yaml exec -T api python -m scripts.embeddings.measure_names
"""

import pathlib

import numpy as np
import onnxruntime as ort
import yaml
from tokenizers import Tokenizer

from reference_api.services.embeddings import embed

FILES = pathlib.Path("/srv/reference/files")
FIX = pathlib.Path("/srv/reference/fixtures")
prints = yaml.safe_load((FIX / "prints.yaml").read_text(encoding="utf-8"))["files"]

# Как модель знает эти машины — по-английски, как их называют в сети.
ENGLISH = {
    "Об. 268": ["Object 268 tank destroyer", "Soviet Object 268"],
    "ИС-3": ["IS-3 tank", "Soviet IS-3 heavy tank"],
    # С 25.09.2026: is3-summer оказался ИС-7 (поправка владельца). Без ИС-7 в
    # каталоге модель не могла его назвать и промах считался бы попаданием в ИС-3.
    "ИС-7": ["IS-7 tank", "Soviet IS-7 heavy tank"],
    "Conqueror": ["FV214 Conqueror tank", "British Conqueror heavy tank"],
    "Т-14": ["T-14 Armata tank", "Russian Armata tank"],
    "Т-72": ["T-72 tank", "Soviet T-72 main battle tank"],
    "Ми-8": ["Mi-8 helicopter", "Soviet Mi-8 helicopter"],
}
MODELS = FILES / "models/clip-vit-base-patch32"
tok = Tokenizer.from_file(str(MODELS / "tokenizer.json"))
session = ort.InferenceSession(str(MODELS / "text_model_quantized.onnx"), providers=["CPUExecutionProvider"])


def text(s: str) -> np.ndarray:
    v = session.run(None, {"input_ids": np.array([tok.encode(s).ids], dtype=np.int64)})[0][0]
    return v / np.linalg.norm(v)


names = list(ENGLISH)
mats = [np.stack([text(f"a photo of a {p}") for p in ENGLISH[n]]) for n in names]

hit = 0
tanks = 0
for f in prints:
    img = np.array(embed((FILES / "prints" / f["name"]).read_bytes()).vector)
    s = np.array([float((m @ img).max()) for m in mats])
    order = np.argsort(-s)
    guess = names[order[0]]
    ok = guess == f["subject"]
    hit += ok
    tanks += f["category"] == "танк"
    print(f"  {f['subject']:10} → {guess:10} {'да ' if ok else 'нет'}  "
          + ", ".join(f"{names[i]} {s[i]:.3f}" for i in order[:3]))
print(f"\nугадано {hit} из {len(prints)}; случайно из шести танковых названий — один из шести")

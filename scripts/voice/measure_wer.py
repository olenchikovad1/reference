"""Сколько слов расшифровка путает — на наборе фраз, и отдельно слова дела.

Доля ошибок (WER) — правки на слово: замены, пропуски и вставки на число
слов эталона. Эталон — как пишут в замечании (`write` в phrases.json):
«Об. 268» цифрами, «2 см». Перед сверкой — только нижний регистр, ё → е и без
знаков препинания; «два» против «2» — ошибка, потому что в замечании
дизайнер прочтёт то, что написано. Слова дела («Об. 268», «пантон»,
«кокетка») — отдельно: сколько раз из скольких расшифрованы узнаваемо.

Набор по умолчанию — synthetic (синтезатор, число **предварительное**);
набор владельца ляжет рядом тем же форматом.

Где: контейнер api (модель и код сервиса).

    docker compose -f infra/compose.yaml exec -T api python -m scripts.voice.measure_wer
    docker compose -f infra/compose.yaml exec -T api python -m scripts.voice.measure_wer owner
"""

import json
import pathlib
import re
import sys
import time

from reference_api.services import voice

VOICE = pathlib.Path("/srv/reference/files/voice")
#: Слово дела → как его узнать в нормализованной расшифровке.
TERMS = {"Об. 268": r"\bоб 268\b", "пантон": r"\bпантон", "кокетка": r"\bкокетк"}


def norm(s: str) -> list[str]:
    s = s.lower().replace("ё", "е")
    s = re.sub(r"[^\w\s-]", " ", s).replace(" - ", " ")
    return s.split()


def edits(ref: list[str], hyp: list[str]) -> int:
    row = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        prev, row[0] = row[0], i
        for j, h in enumerate(hyp, 1):
            prev, row[j] = row[j], min(row[j] + 1, row[j - 1] + 1, prev + (r != h))
    return row[-1]


def main() -> None:
    name = sys.argv[1] if len(sys.argv) > 1 else "synthetic"
    folder = VOICE / name
    about = json.loads((folder / "phrases.json").read_text(encoding="utf-8"))
    wrong = words = 0
    seen = {t: [0, 0] for t in TERMS}
    spent = 0.0
    for p in about["phrases"]:
        t = time.perf_counter()
        heard, seconds = voice.transcribe((folder / p["file"]).read_bytes())
        spent += time.perf_counter() - t
        ref, hyp = norm(p["write"]), norm(heard)
        e = edits(ref, hyp)
        wrong, words = wrong + e, words + len(ref)
        joined = " ".join(hyp)
        for term, pattern in TERMS.items():
            if re.search(pattern, " ".join(ref)):
                seen[term][1] += 1
                seen[term][0] += bool(re.search(pattern, joined))
        print(f"{p['file']}  ошибок {e}/{len(ref)}  {seconds:4.1f} с\n  надо: {p['write']}\n  есть: {heard}")
    print(f"\nнабор {name}: {about.get('about', '')}")
    print(f"доля слов с ошибкой (WER): {wrong / words:.1%} — {wrong} правок на {words} слов, {len(about['phrases'])} фраз")
    for term, (hit, total) in seen.items():
        print(f"  «{term}»: {hit} из {total}")
    print(f"расшифровка с загрузкой модели: {spent / len(about['phrases']):.1f} с на фразу")


if __name__ == "__main__":
    main()

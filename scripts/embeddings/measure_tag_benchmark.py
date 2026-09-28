"""Замер автотегов по видам картинок против эталона tag_benchmark.yaml (US-0623).

Мерит то, что стоит в коде: вектор — services.embeddings, теги — tags.tag(),
сильные — его же правило. По каждому виду: сколько ожидаемого попало в сильные
и в двадцатку, сколько сильных лишних и F1 по сильным — той же меры, что в
measured_words (prints.yaml), чтобы числа сравнивались с прежними.

Отдельно — ожидаемые слова, которых нет в рабочем словаре модели: их она не
поставит ни при каком качестве, и «не нашла» тут значит другое.

На неполном наборе не считает: нет картинки в томе или вида меньше восьми —
отказ с перечнем. Числа, снятые на другом наборе, со «было» не сравнимы.

    docker compose -f infra/compose.yaml exec -T api python -m scripts.embeddings.measure_tag_benchmark
"""

import pathlib
import sys
from collections import defaultdict

import yaml

from reference_api.config import settings
from reference_api.services import tags as tagging
from reference_api.services import words
from reference_api.services.embeddings import embed as embed_image

FILES = pathlib.Path("/srv/reference/files/prints")
FIX = pathlib.Path("/srv/reference/fixtures")
MIN_PER_KIND = 8


def norm(word: str) -> str:
    # В словаре «вертолет», в эталоне «вертолёт»: сверка не должна зависеть от ё.
    return word.lower().replace("ё", "е")


def main() -> None:
    bench = yaml.safe_load((FIX / "tag_benchmark.yaml").read_text(encoding="utf-8"))
    images = bench["images"]
    missing = [i["name"] for i in images if not (FILES / i["name"]).is_file()]
    per_kind = defaultdict(int)
    for i in images:
        per_kind[i["kind"]] += 1
    short = {k: per_kind[k] for k in bench["kinds"] if per_kind[k] < MIN_PER_KIND}
    if missing or short:
        sys.exit(f"набор неполон — замер не сравним с записанным. Нет в томе: {missing or '—'};"
                 f" видов меньше {MIN_PER_KIND}: {short or '—'}")

    cfg = settings()
    vocab = {norm(w) for w in words.vocabulary(cfg.tag_words, cfg.tag_template)[0]} - set(tagging.excluded())
    print(f"модель {tagging.model_name()}, словарь {len(vocab)} слов, доля сильных {cfg.tag_strong_share}")

    rows: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    lines: list[str] = []
    absent: set[str] = set()
    for img in images:
        exp = {norm(t) for t in img["tags"]}
        got = tagging.tag(embed_image((FILES / img["name"]).read_bytes()).vector)
        strong = {norm(t.name) for t in got if t.strong}
        top = {norm(t.name) for t in got}
        not_in_vocab = exp - vocab
        absent |= not_in_vocab
        r = rows[img["kind"]]
        r["images"] += 1
        r["expected"] += len(exp)
        r["no_word"] += len(not_in_vocab)
        r["strong_hit"] += len(exp & strong)
        r["top_hit"] += len(exp & top)
        r["strong"] += len(strong)
        r["extra"] += len(strong - exp)
        shown = ", ".join(f"{'*' if t.strong else ''}{t.name}" for t in got[:10])
        miss = sorted(exp - top)
        lines.append(f"  {img['kind']:12} {img['name'][:30]:30} {shown}"
                     + (f"  | нет: {', '.join(miss)}" if miss else ""))

    head = f"  {'вид':12} {'карт':>4} {'ожид':>5} {'нет слова':>9} {'в сильных':>9} {'в 20':>5} {'сильных':>7} {'лишних':>6} {'F1':>5}"
    print("\nпо видам (основной вид картинки):\n" + head)
    total: dict[str, int] = defaultdict(int)
    for kind in [*bench["kinds"], "всего"]:
        r = total if kind == "всего" else rows[kind]
        if kind != "всего":
            for k, v in r.items():
                total[k] += v
        f1 = 2 * r["strong_hit"] / (r["strong"] + r["expected"]) if r["expected"] else 0.0
        print(f"  {kind:12} {r['images']:4} {r['expected']:5} {r['no_word']:9} {r['strong_hit']:9}"
              f" {r['top_hit']:5} {r['strong']:7} {r['extra']:6} {f1:5.2f}")
    print(f"\nожидаемых слов нет в рабочем словаре ({len(absent)}): {', '.join(sorted(absent)) or '—'}")
    print("\nпервые десять тегов, * — сильный:")
    print("\n".join(lines))


if __name__ == "__main__":
    main()

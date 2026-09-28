"""Сравнение аниме-разметчиков на эталоне (US-0626): качество, скорость, память.

Картинки — аниме из tag_benchmark.yaml (вид anime или also: anime). Теги
модели — только переведённые и показанные человеку (services/anime.py), плюс
тег вида «аниме»: его ставит маршрутизатор, а не модель. Сверка ожидаемого
слова — по словам тега («голубые волосы» даёт «волосы»). Мера та же, что у
«было» (measured_before): попало, показано, лишнее, F1 = 2·попало/(показано +
ожидаемо).

Каждый кандидат — в своём процессе: память меряется честно, без соседей.

    docker compose -f infra/compose.yaml exec -T api python -m scripts.embeddings.measure_anime_candidates
"""

import json
import subprocess
import sys

CANDIDATES = ["wd-eva02-large-tagger-v3", "wd-swinv2-tagger-v3", "wd-vit-tagger-v3"]  # выбран swinv2 (measured_anime); прочих в описи нет — для перемера вернуть их в models.json

CHILD = r"""
import json, pathlib, time, sys
import yaml
def rss():
    for line in open('/proc/self/status'):
        if line.startswith('VmRSS'):
            return int(line.split()[1]) / 1024
from reference_api.services import anime
base = rss()
bench = yaml.safe_load(pathlib.Path('/srv/reference/fixtures/tag_benchmark.yaml').read_text(encoding='utf-8'))
imgs = [i for i in bench['images'] if i['kind'] == 'anime' or i.get('also') == 'anime']
norm = lambda w: w.lower().replace('ё', 'е')
out = {'images': [], 'untranslated': {}}
anime.tag(pathlib.Path('/srv/reference/files/prints/' + imgs[0]['name']).read_bytes(), sys.argv[1])  # загрузка
loaded = rss() - base
t = time.perf_counter()
for i in imgs:
    r = anime.tag(pathlib.Path('/srv/reference/files/prints/' + i['name']).read_bytes(), sys.argv[1])
    shown = [(t.name, [norm(w) for w in t.words]) for t in r.tags] + [('аниме', ['аниме'])]
    exp = {norm(w) for w in i['tags']}
    got_words = {w for _, ws in shown for w in ws}
    extra = [n for n, ws in shown if not set(ws) & exp]
    out['images'].append({'name': i['name'], 'expected': len(exp), 'hit': len(exp & got_words), 'shown': len(shown),
                          'extra': len(extra), 'tags': [n for n, _ in shown], 'miss': sorted(exp - got_words),
                          'characters': r.characters, 'rating': r.rating, 'adult': r.adult})
    for u in r.untranslated:
        out['untranslated'][u] = out['untranslated'].get(u, 0) + 1
out['seconds_per_image'] = (time.perf_counter() - t) / len(imgs)
out['memory_mb'] = loaded
out['peak_mb'] = rss() - base
print(json.dumps(out, ensure_ascii=False))
"""


def main() -> None:
    results = {}
    for c in CANDIDATES:
        r = subprocess.run([sys.executable, "-c", CHILD, c], capture_output=True, text=True)
        if r.returncode:
            print(f"{c}: упал\n{r.stderr[-800:]}")
            continue
        results[c] = json.loads(r.stdout.strip().splitlines()[-1])

    print(f"  {'модель':26} {'ожид':>4} {'попало':>6} {'показано':>8} {'лишних':>6} {'F1':>5} {'с/карт':>6} {'память':>6}")
    print(f"  {'было: CLIP+словарь':26} {52:4} {3:6} {82:8} {79:6} {0.04:5.2f}")
    for c, r in results.items():
        e = sum(i["expected"] for i in r["images"])
        h = sum(i["hit"] for i in r["images"])
        s = sum(i["shown"] for i in r["images"])
        x = sum(i["extra"] for i in r["images"])
        print(f"  {c:26} {e:4} {h:6} {s:8} {x:6} {2 * h / (s + e):5.2f} {r['seconds_per_image']:6.2f} {r['memory_mb']:6.0f}")
    for c, r in results.items():
        print(f"\n{c}: непереведённых выше порога — {len(r['untranslated'])}:"
              f" {', '.join(f'{k}×{v}' for k, v in sorted(r['untranslated'].items(), key=lambda x: -x[1])[:25])}")
        for i in r["images"]:
            extra = f"  персонаж: {i['characters']}" if i["characters"] else ""
            adult = f"  взрослое: {i['adult']}" if i["adult"] else ""
            print(f"  {i['name'][:28]:28} {', '.join(i['tags'][:12])}  | нет: {', '.join(i['miss'])}{extra}{adult}")


if __name__ == "__main__":
    main()

"""Сравнение общей модели (US-0627): теги по видам, сцена, узнавание дублей,
скорость и память — нынешняя CLIP против SigLIP 2.

Теги — тем же правилом, что в сервисе (services/tags.py): первые 10 000
существительных частотного словаря без исключённых, вес — softmax похожести
с масштабом 100, сильные — не слабее доли 0.2 от первого и не больше десяти.
Для SigLIP правило то же — сравнивается модель, а не правило; доля
подбирается отдельно, когда модель выбрана.

Картинки — все, кроме аниме (их размечает аниме-модель, US-0626). Сцена —
слова снег, зима, лес, гора, небо, дым, огонь, море среди двадцатки.
Узнавание — варианты из scripts/prints/variants.py на трёх картинках
(наименьшая похожесть «та же картинка») против пар «та же категория» и
«чужое» из prints.yaml (наибольшая): порог должен лечь между ними.

Каждый кандидат — в своём процессе: память честная.

    docker compose -f infra/compose.yaml exec -T api python -m scripts.embeddings.measure_general_candidates [кандидат...]
"""

import json
import subprocess
import sys

from scripts.embeddings.encoders import CANDIDATES

CHILD = r"""
import json, pathlib, sys, time
import numpy as np, yaml
def rss():
    for line in open('/proc/self/status'):
        if line.startswith('VmRSS'):
            return int(line.split()[1]) / 1024
from reference_api.services import tags as tagging, words
from scripts.embeddings.encoders import CANDIDATES
from scripts.prints.variants import VARIANTS, make
base = rss()
enc = CANDIDATES[sys.argv[1]]()
FILES = pathlib.Path('/srv/reference/files/prints'); FIX = pathlib.Path('/srv/reference/fixtures')
norm = lambda w: w.lower().replace('ё', 'е')
bench = yaml.safe_load((FIX / 'tag_benchmark.yaml').read_text(encoding='utf-8'))
imgs = [i for i in bench['images'] if i['kind'] != 'anime']
t0 = time.perf_counter()
vec = {i['name']: enc.image((FILES / i['name']).read_bytes()) for i in imgs}
per_image = (time.perf_counter() - t0) / len(imgs)
banned = tagging.excluded()
vocab = [w for w in words.nouns(10000) if w not in banned]
t0 = time.perf_counter()
W = enc.text(vocab)
text_s = time.perf_counter() - t0
loaded = rss() - base
SCENE = {'снег', 'зима', 'лес', 'гора', 'небо', 'дым', 'огонь', 'море'}
rows = {}
lines = []
abs_rows = {}
for i in imgs:
    s = W @ vec[i['name']]
    p = np.exp((s - s.max()) * 100); p /= p.sum()
    order = np.argsort(-p)[:20]
    top = [vocab[k] for k in order]
    sc = [float(p[k]) for k in order]
    strong = {top[k] for k in range(len(top)) if k < 10 and sc[k] >= sc[0] * 0.2}
    exp = {norm(t) for t in i['tags']}
    r = rows.setdefault(i['kind'], dict(images=0, expected=0, hit=0, top=0, strong=0, extra=0, scene=0, scene_exp=0))
    r['images'] += 1; r['expected'] += len(exp); r['hit'] += len(exp & strong); r['top'] += len(exp & set(top))
    r['strong'] += len(strong); r['extra'] += len(strong - exp)
    r['scene'] += len(exp & SCENE & set(top)); r['scene_exp'] += len(exp & SCENE)
    lines.append(f"{i['kind']:12} {i['name'][:28]:28} " + ', '.join(('*' if t in strong else '') + t for t in top[:10]))
    # Правило без соревнования: тег — слово, чьё сходство выше порога (у SigLIP
    # сигмоида по каждому слову отдельно — порог по сходству ей равносилен).
    for q in (0.5, 0.7, 0.9, 1.1):
        thr = float(np.percentile(s, 100 - q))  # верхние q% словаря
        pick = [vocab[k] for k in np.argsort(-s)[:10] if s[k] >= thr]
        a = abs_rows.setdefault(q, dict(expected=0, hit=0, shown=0, scene=0))
        a['expected'] += len(exp); a['hit'] += len(exp & set(pick)); a['shown'] += len(pick); a['scene'] += len(exp & SCENE & set(pick))
same = []
for b in ['td-rusty-print.png', 'rocket.png', 'photo-fruits.png']:
    src = (FILES / b).read_bytes(); v0 = vec[b] if b in vec else enc.image(src)
    for name in VARIANTS:
        if name != 'from_chat':
            same.append(float(v0 @ enc.image(make(name, src))))
prints = yaml.safe_load((FIX / 'prints.yaml').read_text(encoding='utf-8'))
lv = {}
for e in prints['tuning_expectations']:
    for a, b in e['pairs']:
        va = vec.get(a); vb = vec.get(b)
        va = va if va is not None else enc.image((FILES / a).read_bytes())
        vb = vb if vb is not None else enc.image((FILES / b).read_bytes())
        lv.setdefault(e['level'], []).append(float(va @ vb))
print(json.dumps({'abs': {str(k): v for k, v in abs_rows.items()}, 'rows': rows, 'lines': lines, 'same': same, 'levels': lv, 'per_image': per_image,
                  'text_s': text_s, 'memory_mb': loaded}, ensure_ascii=False))
"""


def main() -> None:
    names = sys.argv[1:] or list(CANDIDATES)
    res = {}
    for n in names:
        r = subprocess.run([sys.executable, "-c", CHILD, n], capture_output=True, text=True)
        if r.returncode:
            print(f"{n}: упал\n{r.stderr[-1200:]}")
            continue
        res[n] = json.loads(r.stdout.strip().splitlines()[-1])
    kinds = ["illustration", "flat", "text", "photo"]
    print("F1 по сильным по видам; сцена — найдено в двадцатке из ожидаемого; узнавание — мин. «та же» / макс. прочих")
    print(f"  {'кандидат':18} " + " ".join(f"{k[:6]:>6}" for k in kinds) + f" {'всего':>6} {'сцена':>7} {'та же':>6} {'катег':>6} {'чужое':>6} {'с/карт':>6} {'память':>6}")
    for n, r in res.items():
        f1 = lambda x: 2 * x['hit'] / (x['strong'] + x['expected']) if x['expected'] else 0
        tot = {k: sum(r['rows'][kk][k] for kk in kinds) for k in r['rows'][kinds[0]]}
        lv = r['levels']
        print(f"  {n:18} " + " ".join(f"{f1(r['rows'][k]):6.2f}" for k in kinds) + f" {f1(tot):6.2f}"
              f" {tot['scene']:3}/{tot['scene_exp']:<3} {min(r['same']):6.3f} {max(lv.get('та же категория', [0])):6.3f}"
              f" {max(lv.get('чужое', [0])):6.3f} {r['per_image']:6.2f} {r['memory_mb']:6.0f}")
    print("\nбез соревнования: тег — слово выше порога (верхние q% словаря у картинки), до десяти")
    for n, r in res.items():
        for q, a in r["abs"].items():
            print(f"  {n:18} q={q:4}  попало {a['hit']:3}/{a['expected']}  показано {a['shown']:3}"
                  f"  F1 {2 * a['hit'] / (a['shown'] + a['expected']):.2f}  сцена {a['scene']}/35")
    for n, r in res.items():
        print(f"\n== {n}")
        print("\n".join("  " + x for x in r["lines"]))


if __name__ == "__main__":
    main()

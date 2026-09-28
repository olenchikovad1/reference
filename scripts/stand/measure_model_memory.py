"""Сколько памяти занимает каждая модель в работе — не вес файла (US-0624).

Бюджет — 2 ГБ оперативной памяти на все модели вместе (владелец 26.09.2026),
и мерится настоящее потребление: onnx-файл в 135 МБ в памяти может стоить
вдвое больше. Каждая модель — в своём процессе, чтобы соседи не делили с ней
библиотеки и не прятали её прирост: RSS до загрузки, после загрузки и после
прогона на настоящей картинке или слове. Числа переносятся в models.json
(memory_mb) руками — том только на чтение.

Где: контейнер api.

    docker compose -f infra/compose.yaml exec -T api python -m scripts.stand.measure_model_memory
"""

import subprocess
import sys

PROBES = {
    "clip-vit-b32-vision": (
        "from reference_api.services import embeddings as e; import pathlib;"
        " e.embed(pathlib.Path('/srv/reference/files/prints/rocket.png').read_bytes())"
    ),
    "clip-vit-b32-multilingual": "from reference_api.services import words; words.embed(['танк в снегу'])",
    "wd-swinv2-tagger-v3": (
        "from reference_api.services import anime; import pathlib;"
        " anime.tag(pathlib.Path('/srv/reference/files/prints/anime-sailor-fuku.png').read_bytes())"
    ),
    "siglip2-base (картинка + текст int8 + словарь)": (
        "from reference_api.services import siglip, tags; import pathlib;"
        " tags.tag(siglip.embed_image(pathlib.Path('/srv/reference/files/prints/rocket.png').read_bytes()).tolist())"
    ),
}

CHILD = """
import resource, time
def rss():
    for line in open('/proc/self/status'):
        if line.startswith('VmRSS'):
            return int(line.split()[1]) / 1024
import numpy, onnxruntime, PIL.Image, tokenizers  # библиотеки — не модель
from reference_api.services import models
base = rss()
t = time.perf_counter()
{probe}
spent = time.perf_counter() - t
peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
print(f"{{rss() - base:.0f}} {{peak - base:.0f}} {{spent:.1f}} {{models.providers()[0]}}")
"""


def main() -> None:
    total = 0.0
    print(f"  {'модель':46} {'в работе, МБ':>12} {'пик, МБ':>8} {'загрузка+прогон, с':>19}  на чём")
    for name, probe in PROBES.items():
        out = subprocess.run([sys.executable, "-c", CHILD.format(probe=probe)],
                             capture_output=True, text=True, check=True).stdout.split()
        work, peak, spent, device = float(out[0]), float(out[1]), out[2], out[3]
        total += work
        print(f"  {name:46} {work:12.0f} {peak:8.0f} {spent:>19}  {device}")
    print(f"  {'всего':46} {total:12.0f}   бюджет 2560")


if __name__ == "__main__":
    main()

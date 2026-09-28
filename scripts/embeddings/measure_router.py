"""Замер: различает ли нынешняя CLIP вид картинки без обучения (US-0625).

Вид — аниме, иллюстрация, плоская графика, надпись, фото — решает, в какую
модель картинка пойдёт. Прежде чем тащить отдельный классификатор, мерится
нулевой: вектор картинки сравнивается с фразами про каждый вид. Две текстовые
половины — английская CLIP и многоязычная, которой уже размечаются теги.

Считается точность по видам на эталоне tag_benchmark.yaml, путаница и зазор
между первым и вторым видом: где зазор мал, картинка «неуверенная» и идёт в
две модели сразу. Порог зазора подбирается здесь — так, чтобы смешанные
(also) и ошибки уходили в две модели, а уверенных оставалось большинство.

    docker compose -f infra/compose.yaml exec -T api python -m scripts.embeddings.measure_router
"""

import pathlib

import numpy as np
import onnxruntime as ort
import yaml
from tokenizers import Tokenizer

from reference_api.services import words
from reference_api.services.embeddings import embed

FILES = pathlib.Path("/srv/reference/files")
FIX = pathlib.Path("/srv/reference/fixtures")

#: Фразы вида. Несколько на вид: вид — это манера, а у манеры много имён.
PROMPTS = {
    "anime": ["an anime illustration", "a manga drawing of a character", "anime style art"],
    "illustration": ["a detailed digital painting", "a shaded illustration", "a realistic drawing"],
    "flat": ["a flat vector clipart", "a simple cartoon icon", "a line art drawing"],
    "text": ["typography", "a word written in letters", "a logo with text", "graffiti lettering"],
    "photo": ["a photo", "a photograph", "a realistic 3d render"],
}


def english() -> callable:
    base = FILES / "models/clip-vit-base-patch32"
    tok = Tokenizer.from_file(str(base / "tokenizer.json"))
    session = ort.InferenceSession(str(base / "text_model_quantized.onnx"), providers=["CPUExecutionProvider"])

    def enc(texts: list[str]) -> np.ndarray:
        out = []
        for s in texts:
            v = session.run(None, {"input_ids": np.array([tok.encode(s).ids], dtype=np.int64)})[0][0]
            out.append(v / np.linalg.norm(v))
        return np.stack(out)

    return enc


def run(label: str, enc, images, vectors) -> None:
    kinds = list(PROMPTS)
    mats = [enc(PROMPTS[k]) for k in kinds]
    scores = np.array([[float((m @ v).mean()) for m in mats] for v in vectors])
    order = np.argsort(-scores, axis=1)
    gap = scores[np.arange(len(images)), order[:, 0]] - scores[np.arange(len(images)), order[:, 1]]

    print(f"\n== {label}")
    hit = {k: [0, 0] for k in kinds}
    wrong = []
    for img, o, g in zip(images, order, gap, strict=True):
        guess = kinds[o[0]]
        hit[img["kind"]][1] += 1
        if guess == img["kind"]:
            hit[img["kind"]][0] += 1
        else:
            wrong.append((img["name"], img["kind"], guess, kinds[o[1]], g))
    for k in kinds:
        print(f"  {k:12} {hit[k][0]}/{hit[k][1]}")
    total = sum(h[0] for h in hit.values())
    print(f"  всего        {total}/{len(images)}")
    print("  ошибки (вид → первый, второй, зазор):")
    for n, k, g1, g2, g in wrong:
        print(f"    {n[:30]:30} {k:12} → {g1}, {g2}  {g:.4f}")

    # Порог зазора: ниже — картинка идёт в две модели (первый и второй вид).
    print("  порог зазора: уверенных верно / уверенных всего; ошибок, спасённых второй моделью;"
          " смешанных, ушедших в обе")
    for thr in (0.0, 0.002, 0.004, 0.006, 0.008, 0.01, 0.015):
        sure = gap >= thr
        sure_ok = sum(1 for i, s in enumerate(sure) if s and kinds[order[i, 0]] == images[i]["kind"])
        saved = sum(1 for i, s in enumerate(sure) if not s and kinds[order[i, 1]] == images[i]["kind"])
        lost = sum(1 for i, s in enumerate(sure) if s and kinds[order[i, 0]] != images[i]["kind"])
        mixed = [i for i, im in enumerate(images) if im.get("also")]
        both = sum(1 for i in mixed if {kinds[order[i, 0]], kinds[order[i, 1]]} >= {images[i]["kind"], images[i]["also"]}
                   and not sure[i])
        print(f"    {thr:.3f}: {sure_ok}/{int(sure.sum())}, спасено {saved}, потеряно {lost},"
              f" смешанных в обе {both}/{len(mixed)}")
    # Что решает маршрут на деле: аниме — в аниме-модель, остальное — в общую
    # (US-0626, US-0627). Неуверенная идёт в модели обоих своих первых видов.
    print("  маршрут аниме: порог; аниме дошло до аниме-модели; чужих в аниме-модели;"
          " не-аниме дошло до общей; ушло в обе")
    anime = kinds.index("anime")
    for thr in (0.0, 0.002, 0.004, 0.006, 0.008, 0.01, 0.015):
        both = gap < thr
        to_anime = [o[0] == anime or (b and o[1] == anime) for o, b in zip(order, both, strict=True)]
        to_general = [o[0] != anime or b for o, b in zip(order, both, strict=True)]
        is_anime = [im["kind"] == "anime" or im.get("also") == "anime" for im in images]
        print(f"    {thr:.3f}: {sum(a and t for a, t in zip(is_anime, to_anime))}/{sum(is_anime)},"
              f" чужих {sum(t and not a for a, t in zip(is_anime, to_anime))},"
              f" общая {sum(g and not a for a, g in zip(is_anime, to_general))}/{sum(not a for a in is_anime)},"
              f" в обе {int(both.sum())}")


def main() -> None:
    bench = yaml.safe_load((FIX / "tag_benchmark.yaml").read_text(encoding="utf-8"))
    images = bench["images"]
    vectors = [np.array(embed((FILES / "prints" / i["name"]).read_bytes()).vector, dtype=np.float32)
               for i in images]
    vectors = [v / np.linalg.norm(v) for v in vectors]
    run("английская CLIP", english(), images, vectors)
    run("многоязычная (как теги)", words.embed, images, vectors)


if __name__ == "__main__":
    main()

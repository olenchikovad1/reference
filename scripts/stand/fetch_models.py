#!/usr/bin/env python3
"""Добыча моделей, без которых стенд собирается, но молча не работает.

Модель весит 85 МБ и в репозиторий не едет: репозиторий для этого не
предназначен, а история с такими файлами перестаёт клонироваться за разумное
время. Но модель, о которой нигде не сказано, превращает стенд в «работает на
моей машине»: на чистом клоне узнавание не откажет внятно, а свалится в
FileNotFoundError из недр onnxruntime.

Запускается на голой машине, до docker compose up:

    py scripts/stand/fetch_models.py

Повторный запуск ничего не скачивает: файл на месте и совпал по размеру.
"""

import hashlib
import pathlib
import sys
import urllib.request

#: Пути моделей ниже — относительно этой папки, как их видит том стенда.
HERE = pathlib.Path(__file__).resolve().parents[2] / "infra/stand"

#: Зрительная часть CLIP в onnx, квантованная. Почему своя модель, а не чужой
#: сервис — решение 0008 в docs/decisions.
MODELS = [
    {
        "path": "files/models/clip-vit-base-patch32/vision_model_quantized.onnx",
        "url": (
            "https://huggingface.co/Xenova/clip-vit-base-patch32/"
            "resolve/main/onnx/vision_model_quantized.onnx"
        ),
        "size": 89_117_001,
    },
    # Английская текстовая половина той же модели и её словарь. Автотеги с
    # US-0482 берут русский кодировщик ниже; эта нужна только замеру
    # scripts/measure_names.py (US-0479) и уходит вместе с ним.
    {
        "path": "files/models/clip-vit-base-patch32/text_model_quantized.onnx",
        "url": (
            "https://huggingface.co/Xenova/clip-vit-base-patch32/"
            "resolve/main/onnx/text_model_quantized.onnx"
        ),
        "size": 64_504_507,
    },
    {
        "path": "files/models/clip-vit-base-patch32/tokenizer.json",
        "url": "https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/tokenizer.json",
        "size": 2_224_119,
    },
    # Многоязычный текстовый кодировщик, дистиллированный в пространство той же
    # CLIP ViT-B/32: русское слово сравнивается с уже лежащими векторами
    # картинок без перевода. Теги без списка допустимых и поиск по весам
    # (US-0482, US-0480). В onnx только трансформер: средний пулинг и слой
    # 768→512 без смещения делаются руками, веса слоя — отдельным файлом.
    {
        "path": "files/models/clip-vit-b32-multilingual/model_quint8_avx2.onnx",
        "url": (
            "https://huggingface.co/sentence-transformers/clip-ViT-B-32-multilingual-v1/"
            "resolve/main/onnx/model_quint8_avx2.onnx"
        ),
        "size": 135_377_779,
    },
    {
        "path": "files/models/clip-vit-b32-multilingual/dense.safetensors",
        "url": (
            "https://huggingface.co/sentence-transformers/clip-ViT-B-32-multilingual-v1/"
            "resolve/main/2_Dense/model.safetensors"
        ),
        "size": 1_572_984,
    },
    {
        "path": "files/models/clip-vit-b32-multilingual/tokenizer.json",
        "url": (
            "https://huggingface.co/sentence-transformers/clip-ViT-B-32-multilingual-v1/"
            "resolve/main/tokenizer.json"
        ),
        "size": 1_961_847,
    },
    # Словарь языка, из которого берутся слова тегов: «Новый частотный словарь
    # русской лексики» (Ляшевская, Шаров). Не список допустимых — его никто не
    # курирует; берутся существительные по частоте.
    {
        "path": "files/dictionaries/freq2011.zip",
        "url": "http://dict.ruslang.ru/Freq2011.zip",
        "size": 493_491,
    },
]


def fetch(model: dict) -> None:
    dst = HERE / model["path"]
    if dst.exists() and dst.stat().st_size == model["size"]:
        print(f"уже на месте: {model['path']}")
        return

    dst.parent.mkdir(parents=True, exist_ok=True)
    print(f"качаю {model['path']} ({model['size'] / 1e6:.0f} МБ)...")
    # Во временный файл: оборванная закачка не должна оставить огрызок,
    # который при следующем запуске сойдёт за модель.
    tmp = dst.with_suffix(dst.suffix + ".part")
    with urllib.request.urlopen(model["url"]) as r, tmp.open("wb") as f:
        digest = hashlib.sha256()
        while chunk := r.read(1 << 20):
            f.write(chunk)
            digest.update(chunk)

    got = tmp.stat().st_size
    if got != model["size"]:
        tmp.unlink()
        sys.exit(f"размер не совпал: ждали {model['size']}, пришло {got}")
    tmp.replace(dst)
    print(f"готово, sha256 {digest.hexdigest()[:16]}...")


if __name__ == "__main__":
    for m in MODELS:
        fetch(m)

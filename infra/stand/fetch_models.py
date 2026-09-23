#!/usr/bin/env python3
"""Добыча моделей, без которых стенд собирается, но молча не работает.

Модель весит 85 МБ и в репозиторий не едет: репозиторий для этого не
предназначен, а история с такими файлами перестаёт клонироваться за разумное
время. Но модель, о которой нигде не сказано, превращает стенд в «работает на
моей машине»: на чистом клоне узнавание не откажет внятно, а свалится в
FileNotFoundError из недр onnxruntime.

Запускается на голой машине, до docker compose up:

    py infra/stand/fetch_models.py

Повторный запуск ничего не скачивает: файл на месте и совпал по размеру.
"""

import hashlib
import pathlib
import sys
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent

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

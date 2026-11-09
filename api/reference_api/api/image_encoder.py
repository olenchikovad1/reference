"""Внутренний HTTP-вход CLIP. Запускается отдельным Uvicorn на Unix-сокете."""

import asyncio
import hashlib
import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import numpy as np
import onnxruntime as ort
from fastapi import FastAPI, HTTPException, Request

from reference_api.config import ImageEncoderSettings
from reference_api.services import embeddings

_MODEL_ID = "clip-vit-b32-vision"


def _load_encoder(config: ImageEncoderSettings) -> ort.InferenceSession:
    inventory = json.loads(config.encoder_inventory_path.read_text(encoding="utf-8"))
    model = next((row for row in inventory["models"] if row["id"] == _MODEL_ID), None)
    if model is None:
        raise ValueError("В описи Reference нет модели CLIP")
    expected = next((item["sha256"] for item in model["files"]
                     if item["path"].endswith("/vision_model_quantized.onnx")), None)
    if expected is None:
        raise ValueError("В описи Reference нет контрольной суммы весов CLIP")
    with config.encoder_weights_path.open("rb") as weights:
        if hashlib.file_digest(weights, "sha256").hexdigest() != expected:
            raise ValueError("Веса CLIP расходятся с описью Reference")
    options = ort.SessionOptions()
    options.intra_op_num_threads = config.encoder_threads
    options.inter_op_num_threads = 1
    return ort.InferenceSession(str(config.encoder_weights_path), sess_options=options,
                                providers=["CPUExecutionProvider"])


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.encoder = await asyncio.to_thread(_load_encoder, ImageEncoderSettings())
    yield


app = FastAPI(lifespan=_lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.post(embeddings.ENCODE_PATH)
async def encode(request: Request) -> embeddings.Embedding:
    """Принять ровно один подготовленный тензор 1×3×224×224 float32 little endian."""
    if request.headers.get("content-type") != "application/octet-stream":
        raise HTTPException(status_code=415, detail="expected_binary_tensor")
    content = bytearray()
    async for chunk in request.stream():
        if len(content) + len(chunk) > embeddings.INPUT_BYTES:
            raise HTTPException(status_code=413, detail="tensor_too_large")
        content.extend(chunk)
    if len(content) != embeddings.INPUT_BYTES:
        raise HTTPException(status_code=400, detail="invalid_tensor")
    pixels = np.frombuffer(content, dtype=embeddings.INPUT_DTYPE).reshape(embeddings.INPUT_SHAPE)
    if not np.isfinite(pixels).all():
        raise HTTPException(status_code=400, detail="invalid_tensor")
    return await asyncio.to_thread(embeddings.encode, request.app.state.encoder, pixels)

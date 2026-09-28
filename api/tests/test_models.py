"""Модели стенда: нет или подменена — сервис говорит какая и какой командой
взять, а не падает из недр onnxruntime (план 087, US-0624)."""

import io
import pathlib
import shutil

import httpx
import pytest
import pytest_asyncio

from reference_api.app import create_app
from reference_api.config import settings
from reference_api.services import embeddings, models

PRINTS = pathlib.Path("/srv/reference/files/prints")
FETCH = "py scripts/stand/fetch_models.py"


def test_full_volume_has_no_problems() -> None:
    assert models.problems(full=True) == []


def test_empty_volume_names_every_file_and_the_command(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(settings(), "files_volume_path", str(tmp_path))
    found = models.problems(full=False)
    assert {p.path for p in found} == {f["path"] for f in models.inventory()}
    assert all(p.reason == "нет" and FETCH in str(p) for p in found)


def test_same_size_substitute_is_caught_by_checksum(tmp_path, monkeypatch) -> None:
    real = pathlib.Path(settings().files_volume_path)
    for f in models.inventory():
        (tmp_path / f["path"]).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(real / f["path"], tmp_path / f["path"])
    victim = tmp_path / "models/clip-vit-b32-multilingual/tokenizer.json"
    data = bytearray(victim.read_bytes())
    data[-2] ^= 1
    victim.write_bytes(bytes(data))
    monkeypatch.setattr(settings(), "files_volume_path", str(tmp_path))

    assert models.problems(full=False) == []  # размер тот же — по размеру не видно
    found = models.problems(full=True)
    assert [(p.path, p.reason) for p in found] == [
        ("models/clip-vit-b32-multilingual/tokenizer.json", "не тот")
    ]


def test_cuda_is_used_when_present_and_cpu_stays_as_fallback(monkeypatch) -> None:
    monkeypatch.setattr(models.ort, "get_available_providers",
                        lambda: ["CUDAExecutionProvider", "CPUExecutionProvider"])
    assert models.providers() == ["CUDAExecutionProvider", "CPUExecutionProvider"]
    monkeypatch.setattr(models.ort, "get_available_providers", lambda: ["CPUExecutionProvider"])
    assert models.providers() == ["CPUExecutionProvider"]


@pytest_asyncio.fixture
async def client():
    from reference_api.db import engine

    app = create_app()
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://stand"
        ) as c:
            yield c
    await engine.dispose()


async def test_missing_model_is_a_named_refusal_not_a_crash(client, monkeypatch) -> None:
    monkeypatch.setattr(settings(), "embedding_model_path", "/srv/reference/files/models/нет/vision.onnx")
    monkeypatch.setattr(embeddings, "_session", None)
    content = (PRINTS / "rocket.png").read_bytes()
    r = await client.post(
        "/reference/api/assets",
        files=[("files", ("rocket.png", io.BytesIO(content), "image/png"))],
    )
    assert r.status_code == 200, r.text
    rec = await client.post("/reference/api/assets/recognise", json=[r.json()[0]["digest"]])
    assert rec.status_code == 503, rec.text
    assert "models/нет/vision.onnx" in rec.json()["detail"]
    assert FETCH in rec.json()["detail"]


def test_substitute_found_at_start_refuses_marking_too(tmp_path, monkeypatch) -> None:
    real = pathlib.Path(settings().files_volume_path)
    for f in models.inventory():
        (tmp_path / f["path"]).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(real / f["path"], tmp_path / f["path"])
    victim = tmp_path / "models/clip-vit-b32-multilingual/tokenizer.json"
    data = bytearray(victim.read_bytes())
    data[-2] ^= 1
    victim.write_bytes(bytes(data))
    monkeypatch.setattr(settings(), "files_volume_path", str(tmp_path))
    monkeypatch.setattr(models, "_flagged", {})

    models.report_at_start()
    with pytest.raises(models.ModelMissing, match="tokenizer.json не та, что в описи"):
        models.require(victim)
    assert models.require(tmp_path / "models/clip-vit-b32-multilingual/dense.safetensors")

"""Импорт добавляет примеры, но не меняет существующую работу получателя."""

import io
import json
import tarfile

import pytest
from sqlalchemy import delete, select

from reference_api.db import session_factory, engine
from reference_api.models.library import LibraryText
from scripts.stand import transfer_examples as transfer


def manifest():
    return {"format": "reference-examples/1",
            "tables": {name: [] for name in transfer.TABLES},
            "dependencies": {name: [] for name in transfer.DEPENDENCIES}, "objects": []}


@pytest.mark.asyncio
async def test_import_is_repeatable_and_check_does_not_write(tmp_path):
    bundle = manifest()
    bundle["tables"]["library_texts"] = [{
        "id": 9531001, "text": "ПРИМЕР ПЕРЕНОСА", "normalised": "ПРИМЕР ПЕРЕНОСА",
        "author_id": None, "created_at": "2026-11-02T00:00:00+00:00",
    }]
    path = tmp_path / "examples.tar"
    with tarfile.open(path, "w") as archive:
        transfer.add_bytes(archive, "manifest.json", json.dumps(bundle).encode())
    async with session_factory() as db:
        await db.execute(delete(LibraryText).where(LibraryText.id == 9531001))
        await db.commit()
    try:
        await transfer.import_bundle(path, False)
        async with session_factory() as db:
            assert await db.get(LibraryText, 9531001) is None
        await transfer.import_bundle(path, True)
        await transfer.import_bundle(path, True)
        async with session_factory() as db:
            rows = (await db.scalars(select(LibraryText).where(LibraryText.id == 9531001))).all()
            assert len(rows) == 1
            rows[0].text = "ИЗМЕНЕНО ПОЛУЧАТЕЛЕМ"
            await db.commit()
        with pytest.raises(ValueError, match="Конфликт library_texts"):
            await transfer.import_bundle(path, True)
        async with session_factory() as db:
            assert (await db.get(LibraryText, 9531001)).text == "ИЗМЕНЕНО ПОЛУЧАТЕЛЕМ"
    finally:
        async with session_factory() as db:
            await db.execute(delete(LibraryText).where(LibraryText.id == 9531001))
            await db.commit()
        await engine.dispose()


def test_corrupted_asset_is_refused_before_writing(tmp_path, monkeypatch):
    bundle = manifest()
    key = "assets/" + "a" * 64 + "/preview"
    bundle["objects"] = [{"key": key, "member": "objects/" + key,
                           "sha256": "b" * 64, "size": 6}]
    path = tmp_path / "corrupted.tar"
    with tarfile.open(path, "w") as archive:
        transfer.add_bytes(archive, "objects/" + key, b"broken")
    # Контрольная сумма проверяется до обращения к S3.
    monkeypatch.setattr(transfer, "object_store", lambda: None)
    with tarfile.open(path, "r") as archive, pytest.raises(ValueError, match="Повреждён файл"):
        transfer.copy_objects(archive, bundle, True)


def test_unknown_table_cannot_be_imported():
    bundle = manifest()
    bundle["tables"]["app_people"] = []
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w") as archive:
        transfer.add_bytes(archive, "manifest.json", json.dumps(bundle).encode())
    stream.seek(0)
    with tarfile.open(fileobj=stream) as archive, pytest.raises(ValueError, match="набор таблиц"):
        transfer.read_manifest(archive)


def test_voice_remark_asset_is_supported():
    bundle = manifest()
    key = "assets/" + "a" * 64 + "/audio"
    bundle["objects"] = [{"key": key, "member": "objects/" + key}]
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w") as archive:
        transfer.add_bytes(archive, "manifest.json", json.dumps(bundle).encode())
    stream.seek(0)
    with tarfile.open(fileobj=stream) as archive:
        assert transfer.read_manifest(archive)["objects"][0]["key"] == key

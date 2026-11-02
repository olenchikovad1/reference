"""Перенос сохранённых примеров между стендом и prod без замены данных.

Контейнер API: python -m scripts.stand.transfer_examples export /transfer/examples.tar
На получателе сначала check, затем import того же архива с --apply.
Архив содержит сохранённые версии и файлы, но не черновики и не доступы.
Справочники не импортируются: сверяются существующие фикстуры-зависимости.
БД фиксируется одной транзакцией после файлов; обрыв оставляет только
непривязанные файлы, повтор продолжает перенос по их контрольным суммам.
"""

from __future__ import annotations

import argparse
import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
import hashlib
import io
import json
from pathlib import Path
import tarfile
from typing import Any

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from sqlalchemy import Date, DateTime, Integer, and_, inspect, select, text, update
from sqlalchemy.dialects.postgresql import insert

from reference_api.config import settings
from reference_api.db import engine, session_factory
from reference_api.models.base import Base
from reference_api.models import drops, library, people, references  # noqa: F401


TABLES = (
    "asset_embeddings", "asset_tags", "asset_kinds", "asset_names", "asset_warnings", "asset_defects",
    "library_texts", "library_audiences", "library_drops", "library_votes",
    "reference_cards", "reference_versions", "reference_texts", "reference_tags",
    "reference_hidden_tags", "reference_status_events", "reference_transfers",
    "reference_remarks", "reference_remark_messages", "reference_agenda_items",
)
DEPENDENCIES = {
    "hierarchy_nodes": ("id", "parent_id", "level", "name"),
    "garment_models": ("id", "code", "category_id", "product_code"),
    "colour_models": ("id", "model_id", "colour_code"),
    "drops": ("id", "code", "name"),
}
# В prod эти связи уже могли появиться из фикстур: решения людей сохраняются.
MERGE_SETS = {"library_audiences", "library_drops"}


def serializable(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if hasattr(value, "tolist"):
        return value.tolist()
    raise TypeError(f"Неподдерживаемый тип: {type(value).__name__}")


def canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, default=serializable)


def add_bytes(archive: tarfile.TarFile, name: str, content: bytes) -> None:
    member = tarfile.TarInfo(name)
    member.size = len(content)
    archive.addfile(member, io.BytesIO(content))


def object_store():
    # Разовые переносы не наследуют долгие умолчания boto3 при обрыве сети.
    cfg = settings()
    return boto3.client("s3", endpoint_url=cfg.s3_endpoint,
                        aws_access_key_id=cfg.s3_access_key, aws_secret_access_key=cfg.s3_secret_key,
                        region_name=cfg.s3_region,
                        config=Config(signature_version="s3v4", connect_timeout=5, read_timeout=20,
                                      retries={"max_attempts": 2}))


async def export_bundle(path: Path) -> None:
    cfg = settings()
    manifest: dict[str, Any] = {"format": "reference-examples/1", "tables": {}, "dependencies": {}, "objects": []}
    async with engine.connect() as connection:
        await connection.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"))
        available = await connection.run_sync(lambda conn: {
            name: {column["name"] for column in inspect(conn).get_columns(name)}
            for name in (*TABLES, *DEPENDENCIES)
        })
        for name in (*TABLES, *DEPENDENCIES):
            table = Base.metadata.tables[name]
            columns = [column for column in table.c if column.name in available[name]]
            if name in DEPENDENCIES:
                columns = [column for column in columns if column.name in DEPENDENCIES[name]]
            rows = [dict(row) for row in (await connection.execute(select(*columns))).mappings()]
            manifest["dependencies" if name in DEPENDENCIES else "tables"][name] = rows
    store = object_store()
    with tarfile.open(path, "w") as archive:
        for page in store.get_paginator("list_objects_v2").paginate(Bucket=cfg.s3_bucket, Prefix="assets/"):
            for entry in page.get("Contents", []):
                key = entry["Key"]
                obj = store.get_object(Bucket=cfg.s3_bucket, Key=key)
                content = obj["Body"].read()
                sha = hashlib.sha256(content).hexdigest()
                name = f"objects/{key}"
                add_bytes(archive, name, content)
                manifest["objects"].append({
                    "key": key, "member": name, "sha256": sha, "size": len(content),
                    "content_type": obj.get("ContentType", "application/octet-stream"),
                    "metadata": obj.get("Metadata", {}),
                })
        add_bytes(archive, "manifest.json", canonical(manifest).encode())
    print(canonical({"exported": {name: len(rows) for name, rows in manifest["tables"].items()},
                     "objects": len(manifest["objects"]), "bytes": path.stat().st_size}), flush=True)


def typed_row(name: str, row: dict[str, Any]) -> dict[str, Any]:
    table = Base.metadata.tables[name]
    if set(row) - set(table.c.keys()):
        raise ValueError(f"Неизвестные колонки: {name}")
    converted = dict(row)
    for column in table.c:
        value = converted.get(column.name)
        if isinstance(value, str) and isinstance(column.type, DateTime):
            converted[column.name] = datetime.fromisoformat(value)
        elif isinstance(value, str) and isinstance(column.type, Date):
            converted[column.name] = date.fromisoformat(value)
    return converted


def read_manifest(archive: tarfile.TarFile) -> dict[str, Any]:
    member = archive.extractfile("manifest.json")
    if member is None:
        raise ValueError("Нет описи")
    manifest = json.load(member)
    if manifest.get("format") != "reference-examples/1" or set(manifest["tables"]) != set(TABLES):
        raise ValueError("Неизвестный формат или набор таблиц")
    if set(manifest["dependencies"]) != set(DEPENDENCIES):
        raise ValueError("Неизвестные зависимости")
    for entry in manifest["objects"]:
        parts = entry["key"].split("/")
        if len(parts) != 3 or parts[0] != "assets" or len(parts[1]) != 64 or parts[2] not in ("original", "thumb", "preview", "audio"):
            raise ValueError(f"Недопустимое имя объекта: {entry['key']}")
        if entry["member"] != f"objects/{entry['key']}":
            raise ValueError("Несовпадающее имя файла")
    return manifest


async def validate_database(db, manifest: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    for name, rows in manifest["dependencies"].items():
        table = Base.metadata.tables[name]
        for row in rows:
            existing = (await db.execute(select(table).where(table.c.id == row["id"]))).mappings().one_or_none()
            if existing is None or any(existing[key] != value for key, value in row.items()):
                raise ValueError(f"Не совпадает фикстура {name}:{row['id']}; каталог не импортирован")
    pending: dict[str, list[dict[str, Any]]] = {}
    for name in TABLES:
        table = Base.metadata.tables[name]
        pending[name] = []
        for serialized in manifest["tables"][name]:
            row = typed_row(name, serialized)
            primary_key = and_(*(column == row[column.name] for column in table.primary_key))
            existing = (await db.execute(select(table).where(primary_key))).mappings().one_or_none()
            if existing is not None:
                if name not in MERGE_SETS and canonical({key: existing[key] for key in row}) != canonical(row):
                    raise ValueError(f"Конфликт {name}: существующая строка не будет перезаписана")
            else:
                pending[name].append(row)
    return pending


def copy_objects(archive: tarfile.TarFile, manifest: dict[str, Any], apply: bool) -> dict[str, int]:
    store, bucket = object_store(), settings().s3_bucket
    counts = {"copied": 0, "existing": 0, "checked": 0}

    def copy_one(item):
        entry, content = item
        if hashlib.sha256(content).hexdigest() != entry["sha256"] or len(content) != entry["size"]:
            raise ValueError(f"Повреждён файл {entry['key']}")
        try:
            current = store.get_object(Bucket=bucket, Key=entry["key"])
        except ClientError as failure:
            if failure.response["Error"]["Code"] not in ("NoSuchKey", "404"):
                raise
        else:
            if hashlib.sha256(current["Body"].read()).hexdigest() != entry["sha256"]:
                raise ValueError(f"Конфликт объекта {entry['key']}")
            return "existing"
        if apply:
            store.put_object(Bucket=bucket, Key=entry["key"], Body=content,
                             ContentType=entry["content_type"], Metadata=entry["metadata"], IfNoneMatch="*")
            return "copied"
        return "checked"

    with ThreadPoolExecutor(max_workers=6) as workers:
        entries = manifest["objects"]
        for offset in range(0, len(entries), 6):
            batch = []
            for entry in entries[offset:offset + 6]:
                member = archive.extractfile(entry["member"])
                if member is None:
                    raise ValueError(f"Нет файла {entry['key']}")
                batch.append((entry, member.read()))
            for outcome in workers.map(copy_one, batch):
                counts[outcome] += 1
            if offset % 120 == 0:
                print(canonical({"objects_done": offset + len(batch), **counts}), flush=True)
    return counts


async def import_bundle(path: Path, apply: bool) -> None:
    with tarfile.open(path, "r") as archive:
        manifest = read_manifest(archive)
        async with session_factory() as db:
            pending = await validate_database(db, manifest)
        print(canonical({"pending": {name: len(rows) for name, rows in pending.items()}, "apply": apply}), flush=True)
        objects = copy_objects(archive, manifest, apply)
        if apply:
            async with session_factory() as db, db.begin():
                # Второй перенос не может вклиниться между сверкой и INSERT.
                await db.execute(text("SELECT pg_advisory_xact_lock(9531)"))
                await db.execute(text("LOCK TABLE " + ", ".join(TABLES) + " IN SHARE ROW EXCLUSIVE MODE"))
                pending = await validate_database(db, manifest)
                forks = []
                for name, rows in pending.items():
                    table = Base.metadata.tables[name]
                    for row in rows:
                        if name == "reference_cards" and row.get("forked_from_version_id"):
                            forks.append((row["id"], row["forked_from_version_id"]))
                            row = {**row, "forked_from_version_id": None}
                        await db.execute(insert(table).values(**row))
                table = Base.metadata.tables["reference_cards"]
                for card_id, version_id in forks:
                    await db.execute(update(table).where(table.c.id == card_id).values(forked_from_version_id=version_id))
                for name in TABLES:
                    table = Base.metadata.tables[name]
                    if "id" in table.c and table.c.id.primary_key and isinstance(table.c.id.type, Integer):
                        await db.execute(text(
                            f"SELECT setval(pg_get_serial_sequence('{name}', 'id'), "
                            f"GREATEST(COALESCE((SELECT max(id) FROM {name}), 1), "
                            f"pg_sequence_last_value(pg_get_serial_sequence('{name}', 'id')::regclass)), true)"
                        ))
        print(canonical({"complete": apply, "inserted": {name: len(rows) for name, rows in pending.items()}, "objects": objects}), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("export", "check", "import"))
    parser.add_argument("archive", type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if args.action == "import" and not args.apply:
        parser.error("import требует --apply; для проверки используйте check")
    asyncio.run(export_bundle(args.archive) if args.action == "export" else import_bundle(args.archive, args.action == "import"))


if __name__ == "__main__":
    main()

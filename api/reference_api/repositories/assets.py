"""Файлы: как хранятся. Бизнес-смысла здесь нет.

Объектное хранилище, имена по хешу содержимого. Слой изолирован нарочно: когда
появится вход платформы, её сервис файлов заменит этот файл целиком, а всё
остальное останется как есть (решение 0009).
"""

from typing import Any

import boto3
from botocore.client import Config
from urllib.parse import quote, unquote

from botocore.exceptions import ClientError

from reference_api.config import settings

_client: Any = None


def client() -> Any:
    """Один клиент на процесс: создание соединения — не то, что делают в цикле."""
    global _client
    if _client is None:
        cfg = settings()
        _client = boto3.client(
            "s3",
            endpoint_url=cfg.s3_endpoint,
            aws_access_key_id=cfg.s3_access_key,
            aws_secret_access_key=cfg.s3_secret_key,
            region_name=cfg.s3_region,
            config=Config(signature_version="s3v4"),
        )
    return _client


def key_of(digest: str, preset: str) -> str:
    return f"assets/{digest}/{preset}"


def exists(digest: str, preset: str) -> bool:
    try:
        client().head_object(Bucket=settings().s3_bucket, Key=key_of(digest, preset))
        return True
    except ClientError:
        return False


def _ascii(value: str) -> str:
    """Значение метаданных в ASCII.

    S3 хранит метаданные только в ASCII — это ограничение протокола, а не наше
    решение. Имена файлов у нас русские всегда, и без кодирования хранилище
    отказывает на загрузке, а не на чтении: файл просто не сохраняется.

    Кодируется здесь, а не у вызывающего: ограничение принадлежит хранилищу,
    и вынесенное наружу оно обязывает каждый следующий вызов о нём помнить.
    """
    return quote(value, safe="")


def _readable(value: str) -> str:
    """Обратно из ASCII. Незакодированное значение проходит насквозь: в
    хранилище уже лежат объекты, записанные до кодирования."""
    return unquote(value)


def put(digest: str, preset: str, content: bytes, content_type: str, meta: dict[str, str]) -> None:
    client().put_object(
        Bucket=settings().s3_bucket,
        Key=key_of(digest, preset),
        Body=content,
        ContentType=content_type,
        Metadata={k: _ascii(v) for k, v in meta.items()},
    )


def get(digest: str, preset: str) -> tuple[bytes, str, dict[str, str]] | None:
    try:
        obj = client().get_object(Bucket=settings().s3_bucket, Key=key_of(digest, preset))
    except ClientError:
        return None
    meta = {k: _readable(v) for k, v in obj.get("Metadata", {}).items()}
    return obj["Body"].read(), obj.get("ContentType", "image/png"), meta

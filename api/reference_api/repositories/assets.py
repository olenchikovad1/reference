"""Файлы: как хранятся. Бизнес-смысла здесь нет.

Объектное хранилище, имена по хешу содержимого. Слой изолирован нарочно: когда
появится вход платформы, её сервис файлов заменит этот файл целиком, а всё
остальное останется как есть (решение 0009).
"""

from typing import Any

import boto3
from botocore.client import Config
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


def put(digest: str, preset: str, content: bytes, content_type: str, meta: dict[str, str]) -> None:
    client().put_object(
        Bucket=settings().s3_bucket,
        Key=key_of(digest, preset),
        Body=content,
        ContentType=content_type,
        Metadata=meta,
    )


def get(digest: str, preset: str) -> tuple[bytes, str, dict[str, str]] | None:
    try:
        obj = client().get_object(Bucket=settings().s3_bucket, Key=key_of(digest, preset))
    except ClientError:
        return None
    return obj["Body"].read(), obj.get("ContentType", "image/png"), obj.get("Metadata", {})

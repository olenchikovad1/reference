"""Настройки сервиса: один типизированный объект, проверяемый при старте.

Все значения приходят из окружения. Умолчаний для адресов и ключей нет
сознательно: сервис, поднявшийся с выдуманным адресом базы, падает через час в
непонятном месте, а не в момент запуска.
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Всё, что сервис берёт снаружи. Обязательное отделено от необязательного."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Обязательное: без этого сервис смысла не имеет и подниматься не должен.
    database_url: str
    s3_endpoint: str
    s3_bucket: str
    s3_access_key: str
    s3_secret_key: str

    # Путь к тому файлового пространства. Исходники изделий лежат здесь, а не в
    # объектном хранилище (решение 0002).
    files_volume_path: str
    # Описания изделий: тот же принцип, отдельный том только на чтение.
    fixtures_path: str

    # Платформа. На базовом стенде приложение поднимается без неё (решение 0006),
    # поэтому значения необязательные — но как только появится первый маршрут с
    # объявлением права, они станут обязательными.
    platform_core_url: str | None = None
    platform_jwks_url: str | None = None
    platform_app_code: str = "reference"

    s3_region: str = "ru-central1"
    amqp_url: str | None = None
    log_level: str = "INFO"

    # Префикс, под которым приложение живёт в платформе. В разработке он
    # отличается от боевого намеренно: так зашитый корень виден до выкладки.
    base_path: str = "/reference/api"


@lru_cache
def settings() -> Settings:
    """Один экземпляр на процесс. Чтение окружения — не то, что делают в цикле."""
    return Settings()

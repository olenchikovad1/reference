"""Тесты работают в СВОЕЙ базе, а не в базе стенда.

Две причины, и обе проявились не в теории. Векторы узнавания копятся: прогон
оставляет их в базе, следующий находит собственные прошлые следы и проходит
по чужому наследству, а не по тому, что проверяет. И обратное — прогон,
чистящий общую базу, стирает то, что человек накопил руками в браузере.

Адрес подменяется здесь, в теле conftest, а не в оснастке: pytest исполняет
этот файл до импорта тестовых модулей, а движок создаётся при импорте
``reference_api.db``. Подмена в фикстуре опоздала бы ровно на один импорт.
"""

import asyncio
import pathlib
import os

_SUFFIX = "_test"

# Тесты по умолчанию — стенд без платформы (решение 0006): запрос без токена
# получает стендового субъекта со всеми грантами манифеста. Иначе каждый тест
# сохранения и загрузки упирался бы в «нет такого пути». Права проверяют
# отдельные тесты, собирая приложение с without_platform=False (test_rights.py).
# Ставится, а не предлагается по умолчанию: у стенда за платформой в api/.env
# WITHOUT_PLATFORM=false, контейнер наследует его, и 28.09.2026 это уронило
# 66 тестов — набор зависел от того, подключён ли стенд к платформе.
os.environ["WITHOUT_PLATFORM"] = "true"


def _switch_to_test_database() -> None:
    url = os.environ["DATABASE_URL"]
    base, _, name = url.rpartition("/")
    if name.endswith(_SUFFIX):
        return
    asyncio.run(_create_if_absent(base, name + _SUFFIX))
    os.environ["DATABASE_URL"] = f"{base}/{name}{_SUFFIX}"


async def _create_if_absent(base: str, name: str) -> None:
    """Создаёт базу, если её ещё нет.

    Через asyncpg напрямую: CREATE DATABASE не выполняется внутри транзакции,
    а SQLAlchemy заворачивает в неё всё.
    """
    import asyncpg

    dsn = base.replace("postgresql+asyncpg://", "postgresql://") + "/postgres"
    conn = await asyncpg.connect(dsn)
    try:
        exists = await conn.fetchval("select 1 from pg_database where datname = $1", name)
        if not exists:
            await conn.execute(f'create database "{name}"')
    finally:
        await conn.close()


def _bring_schema_up() -> None:
    """Схему тестовой базы поднимают ТЕ ЖЕ миграции, что и боевую.

    Создавать её из метаданных было бы быстрее и проверяло бы другое: тогда
    сломанная миграция проходит все тесты и обнаруживается на выкатке.
    """
    from alembic import command
    from alembic.config import Config

    cfg = Config(str(pathlib.Path(__file__).resolve().parents[1] / "alembic.ini"))
    command.upgrade(cfg, "head")


def _switch_to_test_bucket() -> None:
    """Своя корзина хранилища, как своя база: 28.09.2026 выяснилось, что тесты
    клали и стирали файлы в корзине стенда — тест «удалить насовсем» при
    каждом прогоне уносил из хранилища стенда настоящий принт вертолёта."""
    import boto3
    from botocore.config import Config
    from botocore.exceptions import ClientError

    name = os.environ["S3_BUCKET"]
    if name.endswith(_SUFFIX.replace("_", "-")):
        return
    test = name + _SUFFIX.replace("_", "-")
    s3 = boto3.client("s3", endpoint_url=os.environ["S3_ENDPOINT"], aws_access_key_id=os.environ["S3_ACCESS_KEY"],
                      aws_secret_access_key=os.environ["S3_SECRET_KEY"], region_name=os.environ.get("S3_REGION", "us-east-1"),
                      config=Config(signature_version="s3v4"))
    try:
        s3.head_bucket(Bucket=test)
    except ClientError:
        s3.create_bucket(Bucket=test)
    os.environ["S3_BUCKET"] = test


_switch_to_test_database()
_switch_to_test_bucket()
_bring_schema_up()

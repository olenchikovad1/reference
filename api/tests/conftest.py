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


_switch_to_test_database()
_bring_schema_up()

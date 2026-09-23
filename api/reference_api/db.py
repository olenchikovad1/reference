"""Подключение к PostgreSQL: один engine и один sessionmaker на процесс.

Сессия короткая, на единицу работы. Длинная держит соединение из пула всё время
запроса, и пул кончается раньше, чем нагрузка становится заметной.
"""

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from reference_api.config import settings

engine = create_async_engine(settings().database_url, pool_pre_ping=True)

# expire_on_commit=False: после коммита объекты остаются читаемыми без похода в
# базу, иначе обращение к полю после commit молча делает лишний запрос.
session_factory = async_sessionmaker(engine, expire_on_commit=False)


async def session() -> AsyncIterator[AsyncSession]:
    """Сессия на единицу работы. Коммит — забота сервисного слоя, не этого."""
    async with session_factory() as s:
        yield s

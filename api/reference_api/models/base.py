"""Общий Base для всех моделей.

Один на приложение, а не по одному на домен: миграции собираются из ОДНИХ
метаданных, и разъехавшиеся Base дают автогенерацию, которая молча не видит
половину таблиц.
"""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass

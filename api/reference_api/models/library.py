"""Библиотека элементов: как данные хранятся.

Вектор лежит ОТДЕЛЬНОЙ строкой с именем модели, а не колонкой на элементе: при
смене модели обе версии нужны одновременно, пока идёт пересчёт, и в колонку это
не помещается.
"""

from sqlalchemy import Float, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from pgvector.sqlalchemy import Vector

from reference_api.models.base import Base
from reference_api.services.embeddings import DIM


class AssetEmbedding(Base):
    """Вектор изображения.

    Привязан к ФАЙЛУ (по хешу содержимого), а не к элементу композиции: один и
    тот же файл может лежать в десятке референсов, а считать его стоит один раз.
    """

    __tablename__ = "asset_embeddings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    #: Имя файла по содержимому.
    digest: Mapped[str] = mapped_column(String(64), nullable=False)
    #: Человеческое имя последнего загруженного файла с таким содержимым.
    name: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    #: Чем посчитан. Без него векторы разных моделей смешаются и поиск начнёт
    #: молча мерить не ту похожесть.
    model: Mapped[str] = mapped_column(String(128), nullable=False)
    #: Что именно посчитано: ``image`` — отдельная картинка, ``sheet`` —
    #: печатный лист целиком. Векторы разных видов несравнимы так же, как
    #: векторы разных моделей, и лежат раздельно по той же причине.
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="image")
    vector: Mapped[list[float]] = mapped_column(Vector(DIM), nullable=False)

    __table_args__ = (
        UniqueConstraint("digest", "model", "kind", name="uq_asset_embeddings_digest_model_kind"),
        # Индекс по паре «модель + вектор»: иначе в одном индексе окажутся две
        # системы координат.
        Index(
            "ix_asset_embeddings_vector",
            "vector",
            postgresql_using="hnsw",
            postgresql_ops={"vector": "vector_cosine_ops"},
        ),
    )


class AssetTag(Base):
    """Тег, поставленный картинке автоматически.

    Привязан к ФАЙЛУ, как и вектор: один файл в десятке референсов тегируется
    один раз. Хранится вместе с моделью — сменится модель или словарь, теги
    пересчитываются, а не смешиваются со старыми.
    """

    __tablename__ = "asset_tags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    digest: Mapped[str] = mapped_column(String(64), nullable=False)
    model: Mapped[str] = mapped_column(String(128), nullable=False)
    #: Код тега из словаря: по нему ищут. Имя — для показа.
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    #: Уверенность 0…1. Человек видит её числом и сам решает, верить ли.
    score: Mapped[float] = mapped_column(Float, nullable=False)

    __table_args__ = (
        UniqueConstraint("digest", "model", "code", name="uq_asset_tags_digest_model_code"),
        # Поиск идёт по коду тега: «все снежные» — это все строки с code=snow.
        Index("ix_asset_tags_code", "code"),
    )

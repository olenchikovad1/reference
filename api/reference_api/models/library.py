"""Библиотека элементов: как данные хранятся.

Вектор лежит ОТДЕЛЬНОЙ строкой с именем модели, а не колонкой на элементе: при
смене модели обе версии нужны одновременно, пока идёт пересчёт, и в колонку это
не помещается.
"""

from sqlalchemy import Index, Integer, String, UniqueConstraint
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

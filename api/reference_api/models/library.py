"""Библиотека элементов: как данные хранятся.

Вектор лежит ОТДЕЛЬНОЙ строкой с именем модели, а не колонкой на элементе: при
смене модели обе версии нужны одновременно, пока идёт пересчёт, и в колонку это
не помещается.
"""

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, Index, Integer, String, UniqueConstraint, func
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
    #: Слово словаря языка: по нему ищут. Имя — для показа, сейчас то же слово.
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    #: Вес 0…1 — доля слова среди всех слов словаря. «Сильный» не хранится:
    #: он считается из весов картинки при каждом чтении (services/tags.py).
    score: Mapped[float] = mapped_column(Float, nullable=False)

    __table_args__ = (
        UniqueConstraint("digest", "model", "code", name="uq_asset_tags_digest_model_code"),
        # Поиск идёт по слову тега: «все с танком» — это все строки с code=танк.
        Index("ix_asset_tags_code", "code"),
    )


class AssetName(Base):
    """Что за изделие на картинке: «Т-72», «ИС-3».

    Одно на файл, и всегда с источником: подпись из каталога и название,
    унаследованное от той же картинки, — разная надёжность, и человек должен
    видеть, какая перед ним. Догадки модели здесь не бывает: названий машин
    модель не различает (замер US-0479).
    """

    __tablename__ = "asset_names"

    digest: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    #: catalog — подпись в каталоге набора; inherited — от той же картинки.
    source: Mapped[str] = mapped_column(String(16), nullable=False)
    #: От какого файла унаследовано. У подписи из каталога пусто.
    from_digest: Mapped[str | None] = mapped_column(String(64), nullable=True)


class LibraryText(Base):
    """Надпись библиотеки, заведённая заранее — до того, как попала в
    референс: «С НОВЫМ 2027» под будущий дроп (US-0496).

    Надписи из референсов здесь не лежат — они в reference_texts у версий и
    собираются оттуда; здесь только то, чего ни в одном референсе ещё нет.
    """

    __tablename__ = "library_texts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    #: Как написал человек.
    text: Mapped[str] = mapped_column(String(1024), nullable=False)
    #: Верхний регистр, схлопнутые пробелы — как у надписей референсов.
    normalised: Mapped[str] = mapped_column(String(1024), nullable=False, unique=True)
    author_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class LibraryDrop(Base):
    """Принт или надпись, предложенные в дроп (US-0497, US-0506).

    Связь «через референс» здесь не лежит — она считается из живых
    референсов и уходит вместе с ними, и одобрения сама не получает; здесь —
    предложенное руками и решение по нему. `key` — хеш файла у картинки,
    нормализованная надпись у текста. Статус — у элемента В ДРОПЕ, а не у
    элемента вообще: одобренное к 23 февраля может быть отклонено к Новому
    году. Отклонённое не удаляется — «почему не взяли» спрашивают позже.
    """

    __tablename__ = "library_drops"

    kind: Mapped[str] = mapped_column(String(8), primary_key=True)
    key: Mapped[str] = mapped_column(String(1024), primary_key=True)
    drop_id: Mapped[int] = mapped_column(ForeignKey("drops.id", ondelete="RESTRICT"), primary_key=True)
    #: Кто предложил — id субъекта платформы; пусто — без входа.
    author_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    #: proposed — предложен; approved — одобрен; rejected — не одобрен.
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="proposed")
    decided_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    #: Причина решения; у отказа обязательна — это держит база, а не экран.
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)

    __table_args__ = (
        CheckConstraint("kind in ('image', 'text')", name="ck_library_drops_kind"),
        CheckConstraint("status in ('proposed', 'approved', 'rejected')", name="ck_library_drops_status"),
        CheckConstraint("status <> 'rejected' or coalesce(trim(reason), '') <> ''", name="ck_library_drops_reason"),
    )


class LibraryAudience(Base):
    """Адресат, назначенный принту или надписи руками (US-0497)."""

    __tablename__ = "library_audiences"

    kind: Mapped[str] = mapped_column(String(8), primary_key=True)
    key: Mapped[str] = mapped_column(String(1024), primary_key=True)
    audience: Mapped[str] = mapped_column(String(8), primary_key=True)
    author_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        CheckConstraint("kind in ('image', 'text')", name="ck_library_audiences_kind"),
        CheckConstraint("audience in ('boys', 'girls', 'all')", name="ck_library_audiences_audience"),
    )

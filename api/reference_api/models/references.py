"""Референсы и их версии: карточка, неизменяемые версии, надписи версий.

Слой: models. Как данные хранятся и какие ограничения держит база.

Надпись лежит ОТДЕЛЬНОЙ строкой, а не полем и не массивом на референсе: по ней
идёт поиск — и точный, и триграммный, — а индекс строится по столбцу, не по
элементу массива. Почему надпись узнаётся по словам, а не вектором — решение
0010.
"""

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from reference_api.models.base import Base


class Reference(Base):
    """Референс — карточка: единица работы и согласования. Содержимое лежит в
    версиях; сама карточка хранит то, что от версии к версии не меняется: на
    какой цветомодели и от какой чужой версии пошла.
    """

    # Имя таблицы не "references": это зарезервированное слово SQL, и жить
    # оно будет только в кавычках — ловушка на каждом ручном запросе.
    __tablename__ = "reference_cards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    #: Имя последней сохранённой версии: витрина и список показывают его.
    #: Меняется с каждым сохранением — это карточка, а не версия (И-6 про версии).
    name: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    #: На какой цветомодели референс — изделие в цвете; от неё он берёт дроп и
    #: адресата (US-0489). Пусто — сохранён до справочников.
    colour_model_id: Mapped[int | None] = mapped_column(ForeignKey("colour_models.id", ondelete="RESTRICT"))
    #: «Сохранить как»: от какой версии другого референса пошёл. Пусто — начат
    #: с чистого листа.
    forked_from_version_id: Mapped[int | None] = mapped_column(
        ForeignKey("reference_versions.id", ondelete="RESTRICT", use_alter=True)
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    versions: Mapped[list["ReferenceVersion"]] = relationship(
        back_populates="reference",
        foreign_keys="ReferenceVersion.reference_id",
        order_by="ReferenceVersion.number",
        # Версии несут работу целиком, и тянуть их к каждой карточке списка —
        # грузить мегабайты ради имён. Достаются явным запросом репозитория.
        lazy="raise",
    )
    forked_from: Mapped["ReferenceVersion | None"] = relationship(
        foreign_keys=[forked_from_version_id], lazy="raise"
    )


class ReferenceVersion(Base):
    """Сохранённое состояние референса. Неизменяема (И-6): правка — это новая
    версия с номером на единицу больше последней, пути обновления нет.

    Лист хранится ССЫЛКОЙ на файл, а не картинкой в строке: он уже лежит в
    хранилище со своими ступенями, и вторая копия разошлась бы с первой.
    """

    __tablename__ = "reference_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    reference_id: Mapped[int] = mapped_column(
        ForeignKey("reference_cards.id", ondelete="RESTRICT"), nullable=False
    )
    #: Номер внутри референса, с единицы. Его и называют: «вернись ко второй».
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    #: Печатный лист целиком — по нему считается вектор «такой принт уже был».
    sheet_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    #: Картинки, из которых собран. Массив postgresql, а не общий: пересечение
    #: массивов (оператор &&) есть только у него, а поиск «карточки, где
    #: встречается хоть одна из этих картинок» — это ровно пересечение.
    image_digests: Mapped[list[str]] = mapped_column(ARRAY(String(64)), default=list)
    #: Кто сохранил — id субъекта платформы из токена. Не ссылка на таблицу
    #: людей: её здесь нет и не будет (И-5); имя для показа — из снимка людей
    #: приложения (US-0508). Пусто — сохранено без входа (стенд без платформы
    #: или до US-0486).
    author_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    #: Работа целиком: стороны, сантиметры, исключения размеров, цвет,
    #: выбранный размер. Документом, а не таблицами: форма работы ещё будет
    #: меняться с каждой историей, а искать по её полям никто не будет — ищут
    #: по надписям и картинкам, они лежат рядом отдельно. Пусто — версия
    #: сохранена до того, как работу начали хранить.
    work: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    #: Снимки изделия по сторонам, сделанные при сохранении: код стороны →
    #: имя файла в хранилище. Витрина показывает их, а не рисует изделия на
    #: лету — шестьдесят карточек не должны рисовать сто двадцать изделий.
    #: Пусто — версия сохранена до витрины (US-0491).
    views: Mapped[dict[str, str] | None] = mapped_column(JSONB, nullable=True)

    reference: Mapped[Reference] = relationship(
        back_populates="versions", foreign_keys=[reference_id], lazy="joined"
    )
    texts: Mapped[list["ReferenceText"]] = relationship(
        back_populates="version", cascade="all, delete-orphan", lazy="selectin"
    )

    __table_args__ = (
        # Номер версии назначает сервис, повтор держит база: два сохранения
        # наперегонки не получат оба «№3».
        UniqueConstraint("reference_id", "number", name="uq_reference_version_number"),
        CheckConstraint("number >= 1", name="ck_reference_version_number"),
    )


class ReferenceText(Base):
    """Надпись с версии референса.

    Рядом с исходной лежит нормализованная — по ней идёт ТОЧНОЕ сравнение.
    Считать нормализацию при каждом запросе значит считать её и по каждой
    строке в базе, то есть отказаться от индекса.
    """

    __tablename__ = "reference_texts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    version_id: Mapped[int] = mapped_column(
        ForeignKey("reference_versions.id", ondelete="CASCADE"), nullable=False
    )
    #: Как написал человек — это и показывается в окне.
    text: Mapped[str] = mapped_column(String(1024), nullable=False)
    #: Верхний регистр, схлопнутые пробелы. Точное совпадение ищется здесь.
    normalised: Mapped[str] = mapped_column(String(1024), nullable=False)

    version: Mapped[ReferenceVersion] = relationship(back_populates="texts")

    __table_args__ = (
        Index("ix_reference_texts_normalised", "normalised"),
        # Триграммный индекс: похожая надпись ищется им, и без него поиск
        # превращается в перебор всей таблицы (решение 0010).
        Index(
            "ix_reference_texts_trgm",
            "normalised",
            postgresql_using="gin",
            postgresql_ops={"normalised": "gin_trgm_ops"},
        ),
    )

"""Карточки референсов: дерево слоёв, размещение в сантиметрах, версии.

Слой: models. Как данные хранятся и какие ограничения держит база.

Надпись лежит ОТДЕЛЬНОЙ строкой, а не полем и не массивом на референсе: по ней
идёт поиск — и точный, и триграммный, — а индекс строится по столбцу, не по
элементу массива. Почему надпись узнаётся по словам, а не вектором — решение
0010.
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from reference_api.models.base import Base


class Reference(Base):
    """Собранный принт: что напечатано и как это выглядит листом.

    Лист хранится ССЫЛКОЙ на файл, а не картинкой в строке: он уже лежит в
    хранилище со своими ступенями, и вторая копия разошлась бы с первой.
    """

    # Имя таблицы не "references": это зарезервированное слово SQL, и жить
    # оно будет только в кавычках — ловушка на каждом ручном запросе.
    __tablename__ = "reference_cards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(512), nullable=False, default="")
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
    #: по надписям и картинкам, они лежат рядом отдельно. Пусто — карточка
    #: сохранена до того, как работу начали хранить.
    work: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    texts: Mapped[list["ReferenceText"]] = relationship(
        back_populates="reference", cascade="all, delete-orphan", lazy="selectin"
    )


class ReferenceText(Base):
    """Надпись с референса.

    Рядом с исходной лежит нормализованная — по ней идёт ТОЧНОЕ сравнение.
    Считать нормализацию при каждом запросе значит считать её и по каждой
    строке в базе, то есть отказаться от индекса.
    """

    __tablename__ = "reference_texts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    reference_id: Mapped[int] = mapped_column(
        ForeignKey("reference_cards.id", ondelete="CASCADE"), nullable=False
    )
    #: Как написал человек — это и показывается в окне.
    text: Mapped[str] = mapped_column(String(1024), nullable=False)
    #: Верхний регистр, схлопнутые пробелы. Точное совпадение ищется здесь.
    normalised: Mapped[str] = mapped_column(String(1024), nullable=False)

    reference: Mapped[Reference] = relationship(back_populates="texts")

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

"""Референсы и их версии: карточка, неизменяемые версии, надписи версий.

Слой: models. Как данные хранятся и какие ограничения держит база.

Надпись лежит ОТДЕЛЬНОЙ строкой, а не полем и не массивом на референсе: по ней
идёт поиск — и точный, и триграммный, — а индекс строится по столбцу, не по
элементу массива. Почему надпись узнаётся по словам, а не вектором — решение
0010.
"""

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, Index, Integer, String, UniqueConstraint, func
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
    #: В корзине с этого момента (решение 0014). Пусто — живой. Из корзины
    #: возвращают целиком; через срок корзины она чистится сама.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    #: Кто положил в корзину — id субъекта платформы; пусто — без входа.
    deleted_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    #: Исполнитель (US-0509) — id субъекта платформы: кто делает работу и кому
    #: прилетает доработка. По умолчанию создатель; меняют передачей.
    executor_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    #: Статус согласования (US-0510): draft, review, rework, approved, final.
    #: Только у карточки, не у слоя (запрет 9). Чей ход — вычисляется из него и
    #: ролей, полем не хранится (И-8).
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft", server_default="draft")

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
    #: Версия сделана сама перед переходом (US-0599) — и перед каким: «перед
    #: выгрузкой листа». Пусто — сохранил человек; такая версия важнее.
    auto_reason: Mapped[str | None] = mapped_column(String(120), nullable=True)
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


class ReferenceTag(Base):
    """Свой тег референса — то, чего модель не увидит: «школьная линейка»,
    «повтор бестселлера». В поиске важнее любого автотега (US-0493).

    Рядом с написанным лежит нормализованный: по нему идёт поиск — и точный, и
    триграммный (как у надписей, решение 0010), и форма слова не мешает
    найти «школьную линейку» по «школьн».
    """

    __tablename__ = "reference_tags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    reference_id: Mapped[int] = mapped_column(
        ForeignKey("reference_cards.id", ondelete="CASCADE"), nullable=False
    )
    #: Как написал человек — это и показывается.
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    #: Нижний регистр, схлопнутые пробелы.
    normalised: Mapped[str] = mapped_column(String(120), nullable=False)
    #: Кто дописал — id субъекта платформы; пусто — без входа.
    author_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("reference_id", "normalised", name="uq_reference_tag"),
        Index("ix_reference_tags_trgm", "normalised", postgresql_using="gin",
              postgresql_ops={"normalised": "gin_trgm_ops"}),
    )


class ReferenceHiddenTag(Base):
    """Автотег, скрытый у референса как неверный: «танк» у надписи TANK POWER.

    Хранится у референса, а не у картинки: у другой работы та же картинка
    может быть и правда про танк. Модель тег не возвращает — пересчёт
    автотегов идёт по картинкам и сюда не смотрит.
    """

    __tablename__ = "reference_hidden_tags"

    reference_id: Mapped[int] = mapped_column(
        ForeignKey("reference_cards.id", ondelete="CASCADE"), primary_key=True
    )
    #: Код автотега из словаря модели.
    code: Mapped[str] = mapped_column(String(120), primary_key=True)
    #: Имя тега по-русски: по нему скрытый тег перестаёт находить референс.
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class ReferenceDraft(Base):
    """Черновик — работа человека между версиями (US-0598): пишется сам на
    каждое действие, версией не является и неизменяемости версий (И-6) не
    подчиняется — это ровно то место, где правки живут до «Сохранить».

    Свой у каждого человека: другие видят последнюю версию, а не чужую
    недоделку. Строка на карточку и человека; у новой, ни разу не сохранённой
    работы карточки нет — одна такая строка на человека.

    Со связью только в одну сторону: карточка черновики не грузит никогда, а
    удаление карточки уносит их каскадом базы — черновик без карточки ничей.
    """

    __tablename__ = "reference_drafts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    #: Пусто — новая работа, ещё не сохранённая ни разу.
    reference_id: Mapped[int | None] = mapped_column(ForeignKey("reference_cards.id", ondelete="CASCADE"))
    #: Чей — id субъекта платформы; на стенде без входа — «stand».
    author_id: Mapped[str] = mapped_column(String(64), nullable=False)
    #: Номер версии, поверх которой правки. Пусто — у работы версий нет.
    base_number: Mapped[int | None] = mapped_column(Integer)
    work: Mapped[dict] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        Index(
            "uq_reference_drafts_card_author", "reference_id", "author_id",
            unique=True, postgresql_where=reference_id.is_not(None),
        ),
        Index("uq_reference_drafts_new_author", "author_id", unique=True, postgresql_where=reference_id.is_(None)),
    )


class ReferencePosition(Base):
    """Место карточки в личном порядке витрины (US-0601): «как мне удобно».

    Свой у каждого человека и на сами референсы не влияет — это взгляд, а не
    данные карточки. Карточки без строки стоят в начале, свежие первыми: новая
    работа не прячется в хвосте чужой раскладки.
    """

    __tablename__ = "reference_positions"

    author_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    reference_id: Mapped[int] = mapped_column(
        ForeignKey("reference_cards.id", ondelete="CASCADE"), primary_key=True
    )
    #: Чем меньше, тем ближе к началу витрины.
    position: Mapped[int] = mapped_column(Integer, nullable=False)


class ReferenceTransfer(Base):
    """Передача работы другому исполнителю (US-0509): кто, кому, когда.
    Только дописывается — история передач не правится."""

    __tablename__ = "reference_transfers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    reference_id: Mapped[int] = mapped_column(ForeignKey("reference_cards.id", ondelete="CASCADE"), nullable=False)
    from_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    to_id: Mapped[str] = mapped_column(String(64), nullable=False)
    #: Кто передал; пусто — без входа.
    by_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ReferenceStatusEvent(Base):
    """Переход статуса (US-0510): кто, когда, из какого в какой, на какой
    версии и с каким замечанием. Только дописывается — путь согласования
    виден целиком."""

    __tablename__ = "reference_status_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    reference_id: Mapped[int] = mapped_column(ForeignKey("reference_cards.id", ondelete="CASCADE"), nullable=False)
    from_status: Mapped[str] = mapped_column(String(16), nullable=False)
    to_status: Mapped[str] = mapped_column(String(16), nullable=False)
    #: Номер версии, на которой переход.
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    by_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    #: Замечание при возврате; у остальных переходов — пусто.
    comment: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    #: Имя бота, если шаг сделал ИИ-помощник правами человека `by_id`
    #: (решение платформы 0034); пусто — сам человек.
    bot_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ReferenceRemark(Base):
    """Замечание (US-0511): на слое — принте или надписи — или на месте
    изделия, и на версии, где поставлено. Не удаляется: закрытое остаётся в
    истории — вопрос «а почему так» задают потом."""

    __tablename__ = "reference_remarks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    reference_id: Mapped[int] = mapped_column(ForeignKey("reference_cards.id", ondelete="CASCADE"), nullable=False)
    #: Номер версии, на которой поставлено: в следующих — «из версии N».
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    #: Сторона и точка метки — по желанию (план 095): замечание пишут и просто
    #: текстом к референсу.
    side: Mapped[str | None] = mapped_column(String(32), nullable=True)
    #: Слой — id элемента работы; пусто — замечание на месте изделия.
    element_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    #: Имя слоя на момент замечания — слой могут переименовать и удалить.
    element_name: Mapped[str | None] = mapped_column(String(300), nullable=True)
    #: Точка метки — доли кадра стороны, 0…1: только показ, не размещение (И-1
    #: про принт, а не про метку замечания).
    x: Mapped[float | None] = mapped_column(Float, nullable=True)
    y: Mapped[float | None] = mapped_column(Float, nullable=True)
    text: Mapped[str] = mapped_column(String(2000), nullable=False)
    author_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    #: open — открыто, fixed — исправлено (ждёт автора), accepted — принято.
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open")
    #: Версия, в которой отмечено «исправлено»; пусто — не отмечено.
    fixed_in: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    # Голос (US-0512, решение 0017). Аудио — первоисточник: хеш содержимого в
    # объектном хранилище. Пусто — замечание написано, а не сказано.
    audio_digest: Mapped[str | None] = mapped_column(String(64), nullable=True)
    audio_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    audio_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    #: Расшифровка как услышано — не правится; правится text.
    heard: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    #: pending — ждёт очереди, working — расшифровывается, done, failed.
    voice_status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    voice_error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    voice_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")


class ReferenceRemarkMessage(Base):
    """Сообщение ветки замечания: ответ, «исправлено», «принято», «нет, не
    то». Только дописывается."""

    __tablename__ = "reference_remark_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    remark_id: Mapped[int] = mapped_column(ForeignKey("reference_remarks.id", ondelete="CASCADE"), nullable=False)
    #: reply, fixed, accepted, rejected.
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    text: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    author_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    #: Номер последней версии в момент сообщения.
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ReferenceAgendaItem(Base):
    """Выдвинут на обсуждение (план 097, 098): повод, кто и когда. Не статус —
    решение остаётся в переходах. С повестки уходит решением по референсу
    (шаг статуса) или вручную — чем именно, в resolution. Выдвинуть второй
    раз — ещё один повод к тому же."""

    __tablename__ = "reference_agenda_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    reference_id: Mapped[int] = mapped_column(ForeignKey("reference_cards.id", ondelete="CASCADE"), nullable=False)
    reason: Mapped[str] = mapped_column(String(2000), nullable=False)
    by_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    #: Ушло с повестки; пусто — ещё на ней.
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    removed_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    #: Чем закрыто: шаг статуса (approve, return, reject…) или manual.
    resolution: Mapped[str | None] = mapped_column(String(16), nullable=True)

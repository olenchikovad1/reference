"""Собранный принт: что принимается и что отдаётся."""

from datetime import datetime

from pydantic import BaseModel, Field


class VersionIn(BaseModel):
    """Новая версия референса — «Сохранить»."""

    name: str = ""
    #: Печатный лист целиком — по нему считается «такой принт уже был».
    sheet_digest: str
    image_digests: list[str] = []
    texts: list[str] = []
    #: Работа целиком. Форму её держит страница: сервис хранит и отдаёт
    #: как есть, без разбора, чтобы новая история на странице не требовала
    #: правки сервиса.
    work: dict | None = None
    #: Снимки изделия по сторонам: код стороны → имя файла в хранилище.
    views: dict[str, str] = {}


class ForkIn(BaseModel):
    """От какой версии какого референса пошёл новый — «Сохранить как»."""

    reference_id: int
    number: int


class AutoVersionIn(VersionIn):
    """Версия, сделанная сама перед переходом (US-0599)."""

    #: Перед каким переходом: «перед выгрузкой листа». Пусто — сохранил человек.
    auto_reason: str | None = Field(default=None, max_length=120)


class SaveIn(VersionIn):
    """Новый референс с первой версией."""

    #: Цветомодель — изделие в цвете, на котором референс (US-0489).
    colour_model_id: int | None = None
    #: «Сохранить как». Пусто — референс начат с чистого листа.
    forked_from: ForkIn | None = None


class ReferenceMatchOut(BaseModel):
    #: По чему совпало. Голое число похожести ни о чём не говорит: «совпал
    #: рисунок» и «совпал принт целиком» — разные выводы.
    by: str
    reference_id: int
    name: str
    similarity: float
    #: same — совпало точно; close — похоже, повод посмотреть прошлое.
    level: str
    #: Надпись, если совпало по ней.
    text: str | None = None


class SavedOut(BaseModel):
    #: Номер референса.
    id: int
    #: Номер сохранённой версии внутри референса.
    number: int
    matches: list[ReferenceMatchOut]


class FoundOut(BaseModel):
    id: int
    name: str


class Saver(BaseModel):
    """Кто и когда сохранил версию."""

    saved_at: datetime
    #: id субъекта платформы; пусто — сохранено без входа.
    author_id: str | None = None
    #: Имя для показа — из снимка людей платформы (US-0508); пусто — имя ещё
    #: не приходило. Остаётся и у тех, у кого доступ забрали.
    author_name: str | None = None


class ExecutorOut(BaseModel):
    """Исполнитель референса (US-0509): кто делает работу."""

    id: str
    #: ФИО из таблицы ролей; нет — имя из платформы.
    name: str
    #: Нет доступа к «Референсу» — работу надо передать.
    access: bool


class TransferOut(BaseModel):
    """Передача работы: кто, кому, когда."""

    from_id: str | None
    from_name: str | None
    to_id: str
    to_name: str
    by_id: str | None
    by_name: str | None
    at: datetime


class StatusEventOut(BaseModel):
    """Переход статуса: кто, когда, на какой версии, с каким замечанием."""

    from_: str = Field(alias="from")
    to: str
    number: int
    by_id: str | None
    by_name: str | None
    comment: str | None
    #: Шаг сделал ИИ-помощник правами `by_id` — имя бота; иначе пусто.
    bot_name: str | None = None
    at: datetime

    model_config = {"populate_by_name": True}


class CommentIn(BaseModel):
    comment: str = ""


class TaskOut(BaseModel):
    id: int
    name: str
    status: str
    #: Почему это моя задача: «на согласовании», «вернули: «…»».
    reason: str


class TasksOut(BaseModel):
    #: Что ждёт именно меня.
    mine: list[TaskOut]
    #: Что я отдал и жду от других.
    waiting: list[TaskOut]


class ExecutorIn(BaseModel):
    subject_id: str


class CardOut(Saver):
    """Референс в списке: имя и последняя версия — кто и когда её сохранил."""

    id: int
    name: str
    #: Номер последней версии.
    number: int
    #: Снимки последней версии по сторонам; пусто — сохранена до витрины.
    views: dict[str, str] = {}
    #: Исполнитель (US-0509); нет — референс сохранён до исполнителей и без входа.
    executor: ExecutorOut | None = None
    #: Смотрящий — исполнитель: фильтр «мои» на витрине.
    mine: bool = False
    #: Статус согласования (US-0510).
    status: str = "draft"
    #: Цвет изделия (код палитры) и дропы, где цветомодель выходит; пусто —
    #: референс сохранён без цветомодели.
    colour_code: str | None = None
    drops: list[str] = []
    #: От какого референса пошла копия («Сохранить как», «копировать»).
    forked_from_id: int | None = None
    #: Для фильтра (US-0497): дропы, адресат и вид одежды — от цветомодели.
    drop_ids: list[int] = []
    audience: str | None = None
    category: str | None = None
    #: У смотрящего есть несохранённое по этой карточке (US-0598).
    my_draft: bool = False
    #: У кого ещё — имена: «у Иванова есть несохранённое».
    others_drafts: list[str] = []
    #: Место в личном порядке смотрящего (US-0601); пусто — не расставлена.
    my_position: int | None = None
    #: Выдвинут на обсуждение (план 097) — поводы, пока встреча не прошла.
    agenda: list[str] = []


class OrderIn(BaseModel):
    """Личный порядок витрины целиком — номера карточек от начала."""

    ids: list[int] = Field(max_length=1000)


class DraftIn(BaseModel):
    """Черновик между версиями: работа целиком и версия, поверх которой."""

    work: dict
    base_number: int | None = None


class DraftOut(DraftIn):
    updated_at: datetime


class TrashedOut(CardOut):
    """Референс в корзине: когда удалён и когда сотрётся сам."""

    deleted_at: datetime
    purge_at: datetime


class VersionMetaOut(Saver):
    number: int
    #: Сделана сама перед переходом — перед каким; пусто — сохранил человек.
    auto_reason: str | None = None


class ForkOut(BaseModel):
    reference_id: int
    number: int
    name: str


class HiddenTagIn(BaseModel):
    """Автотег, скрываемый у референса: код из словаря модели и имя."""

    code: str
    name: str


class TagIn(BaseModel):
    name: str


class TagsOut(BaseModel):
    #: Свои теги, как написаны.
    own: list[str]
    #: Скрытые автотеги.
    hidden: list[HiddenTagIn]


class FoundReferenceOut(BaseModel):
    id: int
    name: str
    #: tag — свой тег, drop — дроп, slogan — надпись, picture — картинка по смыслу.
    by: str
    rank: float
    #: Главная причина словами.
    what: str | None = None
    #: Все причины по силе — «дроп „Зима 2026/27“», «на картинке снег, вес 2.6».
    reasons: list[str] = []


class ReferenceOut(BaseModel):
    """Референс целиком: версии для листания и работа последней из них."""

    id: int
    name: str
    colour_model_id: int | None
    #: От какой версии пошёл («Сохранить как»); пусто — с чистого листа.
    forked_from: ForkOut | None
    versions: list[VersionMetaOut]
    #: Номер и работа последней версии — открывают почти всегда её.
    number: int
    #: Пусто — версия сохранена до того, как работу начали хранить.
    work: dict | None
    tags: TagsOut
    #: Свой черновик смотрящего; пусто — правок поверх версий нет.
    draft: DraftOut | None = None
    executor: ExecutorOut | None = None
    #: Передачи работы, по порядку (US-0509).
    transfers: list[TransferOut] = []
    #: Статус согласования и путь переходов по версиям (US-0510).
    status: str = "draft"
    status_events: list["StatusEventOut"] = []
    #: Какие переходы смотрящему доступны сейчас — кнопки окна.
    can: list[str] = []


class VersionOut(VersionMetaOut):
    work: dict | None


class RemarkIn(BaseModel):
    """Замечание (US-0511): текстом к референсу; точка на изделии и слой —
    по желанию (план 095: «картинку такую-то доделай так-то» — без привязки)."""

    side: str | None = None
    #: Точка метки — доли кадра стороны, 0…1; пусто — без метки.
    x: float | None = None
    y: float | None = None
    text: str
    element_id: str | None = None


class RemarkMessageIn(BaseModel):
    #: reply — ответ, fixed — исправлено, accepted — принято, rejected — нет, не то.
    kind: str
    text: str | None = None


class RemarkMessageOut(BaseModel):
    kind: str
    text: str | None
    author_id: str | None
    author_name: str | None
    #: Последняя версия в момент сообщения.
    number: int
    at: datetime


class RemarkOut(BaseModel):
    id: int
    #: Версия, на которой поставлено: в следующих — «из версии N».
    number: int
    side: str | None
    element_id: str | None
    element_name: str | None
    x: float | None
    y: float | None
    text: str
    author_id: str | None
    author_name: str | None
    #: open, fixed, accepted.
    status: str
    #: Версия, где отмечено «исправлено».
    fixed_in: int | None
    created_at: datetime
    messages: list[RemarkMessageOut]
    #: Что смотрящему можно сказать в ветке: reply, fixed, accepted, rejected.
    can: list[str] = []
    #: Голос (US-0512): есть ли запись, её длина, расшифровка как услышано,
    #: и где расшифровка: pending, working, done, failed; пусто — написано.
    audio: bool = False
    audio_seconds: float | None = None
    heard: str | None = None
    voice_status: str | None = None
    voice_error: str | None = None
    #: Может ли смотрящий править текст — только автор замечания.
    can_edit: bool = False


class RemarkTextIn(BaseModel):
    text: str


class MyDraftOut(BaseModel):
    """Мой черновик (US-0685): что поменялось против версии и похоже ли на
    случайное. reference_id пусто — новая, ни разу не сохранённая работа."""

    reference_id: int | None
    name: str
    base_number: int | None
    updated_at: datetime
    changes: list[str]
    accidental: bool


class AgendaReasonOut(BaseModel):
    """Повод обсудить (план 097): что, кто, когда."""

    reason: str
    by_id: str | None
    by_name: str | None
    at: datetime


class ProposeIn(BaseModel):
    reason: str


class AgendaProposedOut(BaseModel):
    reference_id: int
    reasons: list[AgendaReasonOut]


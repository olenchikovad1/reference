"""Собранный принт: что принимается и что отдаётся."""

from datetime import datetime

from pydantic import BaseModel


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


class ForkIn(BaseModel):
    """От какой версии какого референса пошёл новый — «Сохранить как»."""

    reference_id: int
    number: int


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


class CardOut(Saver):
    """Референс в списке: имя и последняя версия — кто и когда её сохранил."""

    id: int
    name: str
    #: Номер последней версии.
    number: int


class VersionMetaOut(Saver):
    number: int


class ForkOut(BaseModel):
    reference_id: int
    number: int
    name: str


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


class VersionOut(VersionMetaOut):
    work: dict | None

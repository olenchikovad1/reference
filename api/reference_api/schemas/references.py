"""Собранный принт: что принимается и что отдаётся."""

from datetime import datetime

from pydantic import BaseModel


class SaveIn(BaseModel):
    name: str = ""
    #: Печатный лист целиком — по нему считается «такой принт уже был».
    sheet_digest: str
    image_digests: list[str] = []
    texts: list[str] = []
    #: Работа целиком. Форму её держит страница: сервис хранит и отдаёт
    #: как есть, без разбора, чтобы новая история на странице не требовала
    #: правки сервиса.
    work: dict | None = None


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
    id: int
    matches: list[ReferenceMatchOut]


class FoundOut(BaseModel):
    id: int
    name: str


class CardOut(BaseModel):
    id: int
    name: str
    created_at: datetime
    #: Кто сохранил — id субъекта платформы; пусто — сохранено без входа.
    author_id: str | None = None
    #: Имя для показа — из снимка людей платформы (US-0508); пусто — имя ещё
    #: не приходило. Остаётся и у тех, у кого доступ забрали.
    author_name: str | None = None


class CardWorkOut(CardOut):
    #: Пусто — карточка сохранена до того, как работу начали хранить.
    work: dict | None

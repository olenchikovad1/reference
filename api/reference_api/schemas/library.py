"""Узнавание: что отдаётся наружу."""

from pydantic import BaseModel


class MatchOut(BaseModel):
    digest: str
    name: str
    similarity: float
    #: same — та же картинка; close — похожая по теме.
    level: str


class TagOut(BaseModel):
    code: str
    name: str
    #: Уверенность 0…1: «Снег 0.89» и «Снег 0.32» — разное, решает человек.
    score: float
    #: Чем поставлен. Сменится модель — теги пересчитываются.
    model: str


class FileTagsOut(BaseModel):
    digest: str
    tags: list[TagOut]


class RecognisedOut(BaseModel):
    """Что узналось по одному файлу.

    Пустой список — ничего похожего не нашлось, и окно не показывается: окно
    «совпадений нет» превращает подсказку в помеху.
    """

    digest: str
    matches: list[MatchOut]
    #: Теги, поставленные сами. Пусто — модель ничего уверенно не увидела.
    tags: list[TagOut] = []

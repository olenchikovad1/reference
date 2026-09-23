"""Узнавание: что отдаётся наружу."""

from pydantic import BaseModel


class MatchOut(BaseModel):
    digest: str
    name: str
    similarity: float
    #: same — та же картинка; close — похожая по теме.
    level: str


class RecognisedOut(BaseModel):
    """Что узналось по одному файлу.

    Пустой список — ничего похожего не нашлось, и окно не показывается: окно
    «совпадений нет» превращает подсказку в помеху.
    """

    digest: str
    matches: list[MatchOut]

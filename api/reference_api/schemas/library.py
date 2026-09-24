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


class NameOut(BaseModel):
    """Что за изделие на картинке, и откуда это известно."""

    name: str
    #: catalog — подпись в каталоге набора; inherited — от той же картинки.
    #: Незнакомое значение клиент показывает как есть, а не падает.
    source: str
    #: От какого файла унаследовано. У подписи из каталога пусто.
    from_digest: str | None = None


class FileTagsOut(BaseModel):
    digest: str
    tags: list[TagOut]
    #: Нет — названия никто не знает. Догадки модели здесь не бывает.
    name: NameOut | None = None


class RecognisedOut(BaseModel):
    """Что узналось по одному файлу.

    Пустой список — ничего похожего не нашлось, и окно не показывается: окно
    «совпадений нет» превращает подсказку в помеху.
    """

    digest: str
    matches: list[MatchOut]
    #: Теги, поставленные сами. Пусто — модель ничего уверенно не увидела.
    tags: list[TagOut] = []
    #: Что за изделие на картинке. Нет — никто не знает; догадки не бывает.
    name: NameOut | None = None

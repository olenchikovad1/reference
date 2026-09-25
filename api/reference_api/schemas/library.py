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
    #: Вес 0…1 — доля слова среди всех слов словаря на этой картинке. Решает
    #: человек, видя число.
    score: float
    #: Сильный — среди первых десяти и не слабее заданной доли от самого
    #: сильного. Где кончаются сильные, решает вес, а не число тегов.
    strong: bool
    #: Чем поставлен. Сменится модель, словарь или перечень исключённого —
    #: теги пересчитываются.
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
    #: Двадцать тегов по весам, поставленных сами. Пусто — картинку не узнавали.
    tags: list[TagOut] = []
    #: Что за изделие на картинке. Нет — никто не знает; догадки не бывает.
    name: NameOut | None = None


class FoundCardOut(BaseModel):
    """Карточка, где стоит найденная картинка."""

    id: int
    name: str


class LibraryItemOut(BaseModel):
    """Картинка библиотеки на странице «Принты»."""

    digest: str
    file_name: str
    tags: list[TagOut]
    name: NameOut | None = None
    #: «Где использован» — референсы с этой картинкой.
    references: list[FoundCardOut]


class FoundOut(BaseModel):
    """Картинка, найденная словом."""

    digest: str
    name: str
    similarity: float
    #: Вес относительно всей библиотеки на этот запрос — по нему порядок.
    weight: float
    references: list[FoundCardOut]

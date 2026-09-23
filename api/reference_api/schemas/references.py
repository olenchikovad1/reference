"""Собранный принт: что принимается и что отдаётся."""

from pydantic import BaseModel


class SaveIn(BaseModel):
    name: str = ""
    #: Печатный лист целиком — по нему считается «такой принт уже был».
    sheet_digest: str
    image_digests: list[str] = []
    texts: list[str] = []


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

"""Разработка коллекции: что принимается и что отдаётся (решение 0020)."""

from pydantic import BaseModel, Field


class LabelOut(BaseModel):
    id: int
    name: str
    tone: str
    position: int
    active: bool


class LabelIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    tone: str = Field(default="slate", max_length=16)


class LabelPatch(BaseModel):
    """Правка метки: что прислано, то и меняется. Удаления нет — гашение."""

    name: str | None = Field(default=None, min_length=1, max_length=80)
    tone: str | None = Field(default=None, max_length=16)
    active: bool | None = None
    position: int | None = None


class SetLabelIn(BaseModel):
    """Метка варианта; null — снять."""

    label_id: int | None


class AddedOut(BaseModel):
    id: int
    number: int
    name: str
    image: str


class PlaceIn(BaseModel):
    """Колонка в новом порядке: база, цвет (пусто — «Идеи») и карточки
    сверху вниз. Перенесённые из другой колонки или с полки встают сюда."""

    style_id: str = Field(min_length=1, max_length=64)
    colorway_id: str | None = Field(default=None, max_length=64)
    ids: list[int] = Field(min_length=1, max_length=500)


class ShelfIn(BaseModel):
    """На полку «Отложено» (true) или обратно в работу (false)."""

    shelved: bool

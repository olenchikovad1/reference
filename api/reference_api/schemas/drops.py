"""Дропы, их ассортимент и справочники: товарная иерархия, модели, цветомодели, адресаты.

Слой: schemas. Что принимается снаружи и что отдаётся наружу.
"""

from datetime import date

from pydantic import BaseModel


class DropOut(BaseModel):
    id: int
    name: str
    season: str
    release_from: date
    release_to: date
    audience: str
    theme: str
    #: Погашенный для нового референса не предлагается, но виден там, где стоит.
    retired: bool


class ModelOut(BaseModel):
    id: int
    code: str
    name: str
    category: str
    #: Можно ли рисовать: у изделия есть кадры. Нельзя — reason говорит почему.
    can_work: bool
    reason: str | None = None


class CellOut(BaseModel):
    colour_model_id: int
    #: Сколько референсов на этой цветомодели; 0 — «ещё не нарисовано».
    references: int


class MatrixRowOut(BaseModel):
    model: ModelOut
    cells: dict[str, CellOut]


class MatrixColourOut(BaseModel):
    code: str
    name: str
    rgb: list[int] | None = None


class MatrixOut(BaseModel):
    drop: DropOut
    colours: list[MatrixColourOut]
    rows: list[MatrixRowOut]


class TreeColourModelOut(BaseModel):
    id: int
    colour_code: str
    drops: list[str]


class TreeModelOut(ModelOut):
    colour_models: list[TreeColourModelOut]


class TreeNodeOut(BaseModel):
    id: int
    level: str
    name: str
    children: list["TreeNodeOut"]
    models: list[TreeModelOut]

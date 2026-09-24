"""Изделия: что отдаётся наружу.

Схемы описывают ровно то, что нужно странице, и ни полем больше: ответ читает
браузер, и лишнее поле — это и лишний байт, и лишнее обещание.
"""

from pydantic import BaseModel, Field


class Calibration(BaseModel):
    """Перевод сантиметров лекала в пиксели кадра."""

    px_per_cm: float
    # Пометка обязательна и не имеет умолчания `False`: число без неё
    # неотличимо от измеренного, а разница между 98-м и 164-м размером больше
    # половины. Принять прикидку за факт — значит отправить на фабрику печать
    # в полтора раза не того размера.
    provisional: bool
    projection: str
    derived_from: str | None = None
    range_if_size_unknown: list[float] | None = None
    note: str | None = None


class Frame(BaseModel):
    """Кадр состояния: где лежит и какого он размера."""

    width: int
    height: int
    sha256: str


class State(BaseModel):
    """Изделие в одном положении."""

    code: str
    display_name: str
    # precise — по нему считают размещение и проверки; illustrative — только показ.
    kind: str
    hood: str | None = None
    zipper: str | None = None
    frame: Frame
    maps: dict[str, str | None] = Field(default_factory=dict)
    silhouette: dict[str, int] = Field(default_factory=dict)
    anchors: dict[str, list[int]] = Field(default_factory=dict)
    zones: dict[str, list[list[int]]] = Field(default_factory=dict)
    lines: dict[str, list[list[int]]] = Field(default_factory=dict)
    defects: list[str] = Field(default_factory=list)


class SizeSet(BaseModel):
    name: str
    sizes: list[int]
    simulated: list[int]


class PrintFields(BaseModel):
    """Ограничение: куда физически можно печатать. Не путать с градацией."""

    provisional: bool
    unit: str
    by_size: dict[int, dict[str, list[float]]]


class PrintRules(BaseModel):
    """Пороги проверок. Данные, а не код: их меняет технолог."""

    provisional: bool
    method: str
    min_letter_cm: float
    warn_letter_cm: float
    min_stroke_cm: float
    max_colours: int


class SizeGrid(BaseModel):
    """Размерная сетка: во сколько раз размер больше базового.

    Отдельна от полей печати (запрет №8): поле ограничивает, сетка
    преобразует. Предварительность без умолчания — по той же причине, что у
    калибровки.
    """

    provisional: bool
    base: int
    method: str
    by_size: dict[int, float]


class TorsoView(BaseModel):
    """Как торс виден на одном кадре."""

    #: С какой стороны смотрит камера: 0 — спереди, 90 — слева, 180 — сзади.
    facing_deg: float
    #: Низ торса на кадре. Общая линия, по которой совмещаются кадры.
    hem_y: float
    #: Постоянная ширина — у переда и спины.
    centre_x: float | None = None
    half_px: float | None = None
    #: Построчный габарит [y, левый край, правый край] — у бока, где торс
    #: заметно сужается кверху.
    rows: list[list[float]] | None = None


class Torso(BaseModel):
    """Упрощённый объём торса: эллиптический цилиндр, измеренный по кадрам.

    Предварительность обязательна и без умолчания — по той же причине, что у
    калибровки: модель, выданная за измеренную, делает выводы о том, чего не
    проверяли.
    """

    provisional: bool
    method: str
    side_seam_deg: float
    views: dict[str, TorsoView]


class Product(BaseModel):
    code: str
    display_name: str
    kind: str
    size_set: SizeSet
    # Какой размер отрендерен — из кадра не определить. Пусто означает «не
    # знаем», и это честнее, чем подставить допущение молча.
    rendered_size: int | None = None
    rendered_size_assumed: int | None = None
    calibration: Calibration
    states: list[State]
    states_absent: list[str] = Field(default_factory=list)
    print_fields: PrintFields | None = None
    print_rules: PrintRules | None = None
    torso: Torso | None = None
    size_grid: SizeGrid | None = None

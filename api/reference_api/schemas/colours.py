"""Цвета: что отдаётся наружу."""

from datetime import date

from pydantic import BaseModel


class Colour(BaseModel):
    """Цвет по справочнику.

    Составляющие числами, а не строкой `#RRGGBB`: по ним считают расстояние
    между цветами при подборе замены, и собрать строку из чисел дешевле, чем
    разобрать числа из строки. Так же устроено в plm.
    """

    group: str
    code: str
    code_short: str
    name: str
    rgb: tuple[int, int, int]


class Palette(BaseModel):
    source: str
    # Дата, а не строка: YAML разбирает её датой, и подменять тип ради удобства
    # значит врать о том, что в файле лежит.
    exported: date
    colors: list[Colour]

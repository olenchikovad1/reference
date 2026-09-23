"""Принты: что отдаётся наружу."""

from pydantic import BaseModel


class Print(BaseModel):
    path: str
    name: str
    # probe — эталон, отвечающий на вопрос про печать; artwork — настоящий принт.
    kind: str
    subject: str | None = None
    # На какой вопрос отвечает эталон. У настоящих принтов пусто.
    answers: str | None = None
    # Настоящий размер эталона на изделии. Сетка в 20 см проверяет
    # калибровку только если ложится ровно двадцатью сантиметрами.
    width_cm: float | None = None

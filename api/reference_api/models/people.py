"""Люди приложения: как хранится снимок из платформы (план 072, US-0508).

Не таблица пользователей (И-5, запрет 3): людей и их роли ведёт платформа,
здесь — проекция только для чтения. Две таблицы, потому что у них разная жизнь:

- `people` — кто СЕЙЧАС имеет доступ и с какими наборами прав. Пересобирается
  с нуля при каждом перечитывании: человек, у которого забрали доступ, из неё
  пропадает, и в выбор исполнителя больше не попадает.
- `subject_names` — последнее известное имя субъекта. Только пополняется: у
  карточки, которую человек сохранил, имя остаётся и после того, как доступ у
  него забрали, — история своих действий не теряет авторов.
"""

from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from reference_api.models.base import Base


class Person(Base):
    __tablename__ = "people"

    #: id субъекта платформы.
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(300), nullable=False)
    #: internal или external: внешнему пользователю список внутренних не
    #: показывают (З-17, З-18 платформы). Приложение сейчас внутреннее целиком.
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    organization_id: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    #: Коды наборов прав из манифеста «Референса», в его порядке. Считает их
    #: платформа: набор засчитан, только если есть КАЖДЫЙ его грант.
    right_sets: Mapped[list[str]] = mapped_column(ARRAY(String(64)), nullable=False, default=list)


class SubjectName(Base):
    __tablename__ = "subject_names"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(300), nullable=False)
    #: Когда имя последний раз пришло от платформы — видно, насколько оно свежее.
    seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

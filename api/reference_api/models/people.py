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

from sqlalchemy import CheckConstraint, DateTime, String, func
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


class AppPerson(Base):
    """Роль человека в согласовании и его ФИО — своя таблица приложения
    (решение 0016). Не доступ: войти и сохранить разрешает платформа; роль
    отвечает, чья очередь и кому можно отдать работу.

    Ключ — id субъекта платформы. Строка не удаляется, когда у человека
    забирают доступ: работа, где он исполнитель, видна с «нет доступа».
    """

    __tablename__ = "app_people"

    subject_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    #: ФИО или ФИ, как пишут в работе: «Иванова Мария Петровна».
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    #: designer — дизайнер, editor — редактор, chief — главный редактор.
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    updated_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        CheckConstraint("role in ('designer','editor','chief')", name="ck_app_people_role"),
        CheckConstraint("length(trim(full_name)) > 0", name="ck_app_people_full_name"),
    )

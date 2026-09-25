"""Дропы, их ассортимент и справочники: товарная иерархия, модели, цветомодели, адресаты.

Слой: models. Как данные хранятся и какие ограничения держит база.

Справочники свои и заполняются руками (решение 0013); устройство — как в Cosmic
и PLM: четыре уровня иерархии, модель на последнем, цветомодель — модель в
цвете палитры, дроп — выпуск с датами и ассортиментом из цветомоделей.
"""

from datetime import date

from sqlalchemy import Boolean, CheckConstraint, Date, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from reference_api.models.base import Base

#: Уровни товарной иерархии по порядку: направление › пол › группа › категория.
LEVELS = ("direction", "gender", "group", "category")

#: Адресат (US-0497): мальчики, девочки, для всех. Кодом, а не словом:
#: слово — для показа, фильтр в адресе держит код.
AUDIENCES = ("boys", "girls", "all")


class HierarchyNode(Base):
    """Узел товарной иерархии. Категория (последний уровень) — вид одежды."""

    __tablename__ = "hierarchy_nodes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("hierarchy_nodes.id", ondelete="RESTRICT"))
    level: Mapped[str] = mapped_column(String(16), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    #: Адресат узла «пол»: модели под ним — для мальчиков или девочек. У
    #: остальных уровней пусто; модель без пола в иерархии — «для всех».
    audience: Mapped[str | None] = mapped_column(String(8), nullable=True)

    parent: Mapped["HierarchyNode | None"] = relationship(remote_side=[id], back_populates="children")
    # join_depth: у связи на саму себя жадная загрузка без неё уходит на один
    # уровень, а глубже в асинхронном режиме падает ленивым запросом.
    children: Mapped[list["HierarchyNode"]] = relationship(back_populates="parent", lazy="selectin", join_depth=4)
    models: Mapped[list["GarmentModel"]] = relationship(back_populates="category", lazy="selectin")

    __table_args__ = (
        CheckConstraint("level in ('direction', 'gender', 'group', 'category')", name="ck_hierarchy_level"),
        # Верхний уровень без родителя, остальные — с ним: дерево, а не лес обрывков.
        CheckConstraint("(level = 'direction') = (parent_id is null)", name="ck_hierarchy_root"),
        UniqueConstraint("parent_id", "name", name="uq_hierarchy_sibling_name"),
        CheckConstraint("audience is null or audience in ('boys', 'girls', 'all')", name="ck_hierarchy_audience"),
    )


class GarmentModel(Base):
    """Модель (артикул) — на последнем уровне иерархии.

    `product_code` — изделие приложения с кадрами и разметкой (описание в томе
    фикстур). Пусто — модель есть в справочнике, но работать на ней нечем: кадров
    нет, и референс на ней не создаётся.
    """

    __tablename__ = "garment_models"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    category_id: Mapped[int] = mapped_column(ForeignKey("hierarchy_nodes.id", ondelete="RESTRICT"), nullable=False)
    product_code: Mapped[str | None] = mapped_column(String(64))

    category: Mapped[HierarchyNode] = relationship(back_populates="models", lazy="joined")
    colour_models: Mapped[list["ColourModel"]] = relationship(back_populates="model", lazy="selectin")


class ColourModel(Base):
    """Модель в цвете палитры. Один цвет на одной модели — одна цветомодель,
    сколько бы дропов её ни включали: это держит уникальность, а не код."""

    __tablename__ = "colour_models"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    model_id: Mapped[int] = mapped_column(ForeignKey("garment_models.id", ondelete="RESTRICT"), nullable=False)
    #: Код цвета из справочника палитры (fixtures/palette.yaml, из Cosmic).
    colour_code: Mapped[str] = mapped_column(String(64), nullable=False)

    model: Mapped[GarmentModel] = relationship(back_populates="colour_models", lazy="joined")
    drops: Mapped[list["Drop"]] = relationship(secondary="drop_items", back_populates="items", lazy="selectin")

    __table_args__ = (UniqueConstraint("model_id", "colour_code", name="uq_colour_model"),)


class Drop(Base):
    """Выпуск к событию или сезону: даты, адресат, тема, ассортимент.

    Погашенный (`retired`) для нового референса не предлагается, но там, где
    уже стоит, остаётся виден: удаления у справочника нет.
    """

    __tablename__ = "drops"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, unique=True)
    #: Сезон как в Cosmic: AW26, SS27.
    season: Mapped[str] = mapped_column(String(16), nullable=False)
    #: Календарные даты выхода, не моменты времени: выпуск — это дни.
    release_from: Mapped[date] = mapped_column(Date, nullable=False)
    release_to: Mapped[date] = mapped_column(Date, nullable=False)
    #: Для кого: «девочки 98–164», «мальчики», «дети».
    audience: Mapped[str] = mapped_column(String(120), nullable=False)
    theme: Mapped[str] = mapped_column(Text, nullable=False, default="")
    retired: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    #: Как его ещё называют (US-0498): «НГ», «новогодний». Своё дописывается у
    #: дропа, общеязыковое — в словаре сокращений services/abbreviations.yaml.
    aliases: Mapped[list[str]] = mapped_column(ARRAY(String(120)), nullable=False, default=list)

    items: Mapped[list[ColourModel]] = relationship(secondary="drop_items", back_populates="drops", lazy="selectin")

    __table_args__ = (CheckConstraint("release_from <= release_to", name="ck_drop_dates"),)


class DropItem(Base):
    """Цветомодель в ассортименте дропа."""

    __tablename__ = "drop_items"

    drop_id: Mapped[int] = mapped_column(ForeignKey("drops.id", ondelete="CASCADE"), primary_key=True)
    colour_model_id: Mapped[int] = mapped_column(ForeignKey("colour_models.id", ondelete="RESTRICT"), primary_key=True)

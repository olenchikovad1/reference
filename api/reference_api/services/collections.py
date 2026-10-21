"""Разработка коллекции: правила предметной области (решение 0020).

Коллекция — релиз PLM, база — его модель, колонка — цветомодель. Всё это
читается из PLM в момент показа (решение 0018); своё здесь — варианты
(карточки референса с внешними ключами PLM), метки и отметки «видел».

Ничего не удаляется (спека PLM 2026-10-21-collection-design-board): у
вариантов нет пути удаления в этом домене, у меток — только гашение.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.config import settings
from reference_api.repositories import collections as repo
from reference_api.services import assets, people, plm

#: Тоны платформы (TONES @platform/ui 1.70): метка красится по имени, кода
#: цвета в справочнике нет. Список повторён, а не прочитан из пакета:
#: бэкенд пакетов фронта не видит; новый тон платформы — строка здесь.
TONES = ("teal", "green", "blue", "amber", "rose", "violet", "slate")

#: Вид работы варианта: картинка на базе целиком, а не собранный принт. Окно
#: работы и узнавание такую версию не открывают — она живёт на доске.
PICTURE = "picture"

SIDES = ("front", "back")


class CollectionMissing(Exception):
    """В PLM нет такого релиза."""


class NotInCollection(Exception):
    """Модель или цветомодель не из этой коллекции."""


class LabelRefused(Exception):
    """Метку завести или поправить нельзя — причина словами."""


class NoSuchVariant(Exception):
    """Варианта с таким номером нет."""


def _plm() -> tuple[str, str]:
    cfg = settings()
    if not cfg.plm_base_url or not cfg.plm_machine_key:
        raise plm.PlmUnavailable("plm не настроен: нет адреса или ключа машинного входа")
    return cfg.plm_base_url, cfg.plm_machine_key


def is_new(
    author_id: str | None,
    number: int,
    seen_number: int | None,
    viewer_id: str | None,
    *,
    label_by: str | None = None,
    label_at: datetime | None = None,
    seen_at: datetime | None = None,
) -> bool:
    """Точка «новое» — что случилось с карточкой, пока меня не было.

    Версия, которую я ещё не открывал, — новое, если она не моя: свою
    картинку автор видел, когда клал. Метка, поставленная кем-то другим после
    моего последнего взгляда, — тоже новое, и для автора в первую очередь:
    ночью Виктория отметила «согласовано» — утром дизайнер это видит (Алиса
    21.10)."""
    if viewer_id is None:
        return False
    if author_id != viewer_id and (seen_number is None or seen_number < number):
        return True
    if label_by is not None and label_by != viewer_id and label_at is not None:
        return seen_at is None or seen_at < label_at
    return False


def base_views(colorways: list[dict[str, Any]]) -> dict[str, dict[str, Any] | None]:
    """Перед и спина базы — из рендеров её цветомоделей в PLM.

    Сторона берётся по имени рендера Лотты (`…_Back.png`), её проставляет
    PLM. Рендера спереди нет — перед показывает главную картинку первой
    цветомодели, где она есть, с пометкой, что сторона не названа: пустая
    база хуже, чем фото, подписанное честно."""
    out: dict[str, dict[str, Any] | None] = {side: None for side in SIDES}
    for colorway in colorways:
        for image in colorway.get("images") or []:
            side = image.get("side")
            if side in out and out[side] is None:
                out[side] = {"key": image["key"], "article": colorway.get("article"), "exact": True}
    if out["front"] is None:
        for colorway in colorways:
            images = colorway.get("images") or []
            main = next((one for one in images if one.get("primary")), images[0] if images else None)
            if main is not None:
                out["front"] = {"key": main["key"], "article": colorway.get("article"), "exact": False}
                break
    return out


def _main_image(colorway: dict[str, Any]) -> str | None:
    images = colorway.get("images") or []
    front = next((one for one in images if one.get("side") == "front"), None)
    main = front or next((one for one in images if one.get("primary")), images[0] if images else None)
    return main["key"] if main else None


async def collections(db: AsyncSession, query: str | None) -> list[dict[str, Any]]:
    """Релизы PLM для выбора — и сколько вариантов уже нарисовано в каждом."""
    base, key = _plm()
    rows = await plm.list_releases(base, key, query=query)
    counts = await repo.variant_counts(db, [row["id"] for row in rows])
    return [{**row, "variants": counts.get(row["id"], 0)} for row in rows]


async def _release(release_id: str) -> dict[str, Any]:
    base, key = _plm()
    try:
        return await plm.release_card(base, key, release_id)
    except plm.PlmMissing:
        raise CollectionMissing("такой коллекции в PLM нет") from None


def _variant_view(
    card: Any, version: Any, seen: Any, event: Any, names: dict[str, str], viewer_id: str | None
) -> dict[str, Any]:
    work = version.work or {}
    label_by = event.by_id if event is not None and event.label_id is not None else None
    label_at = event.at if event is not None and event.label_id is not None else None
    return {
        "id": card.id,
        "name": card.name,
        "number": version.number,
        "image": work.get("image") or version.sheet_digest,
        "author_id": version.author_id,
        "author": names.get(version.author_id or ""),
        "created_at": card.created_at.isoformat(),
        "saved_at": version.created_at.isoformat(),
        "label_id": card.label_id,
        "label_by": names.get(label_by or "") or label_by,
        "label_at": label_at.isoformat() if label_at else None,
        "shelved_at": card.shelved_at.isoformat() if card.shelved_at else None,
        "is_new": is_new(
            version.author_id,
            version.number,
            seen.number if seen else None,
            viewer_id,
            label_by=label_by,
            label_at=label_at,
            seen_at=seen.at if seen else None,
        ),
    }


async def board(db: AsyncSession, release_id: str, viewer_id: str | None) -> dict[str, Any]:
    """Доска: шапка коллекции из PLM, базы — идеи, колонки цветов и полка
    «Отложено», варианты по местам."""
    release = await _release(release_id)
    cards = await repo.variants(db, release_id)
    ids = [card.id for card, _ in cards]
    seen = await repo.seen(db, ids, viewer_id) if viewer_id else {}
    events = await repo.last_label_events(db, ids)
    names = await people.names_of(
        db, [v.author_id for _, v in cards if v.author_id] + [e.by_id for e in events.values() if e.by_id]
    )
    placed: dict[tuple[str, str], list[dict[str, Any]]] = {}
    shelf: dict[str, list[dict[str, Any]]] = {}
    for card, version in cards:
        view = _variant_view(card, version, seen.get(card.id), events.get(card.id), names, viewer_id)
        if card.shelved_at is not None:
            shelf.setdefault(card.plm_style_id or "", []).append(view)
        else:
            placed.setdefault((card.plm_style_id or "", card.plm_colorway_id or ""), []).append(view)
    bases = []
    for style in release.get("styles") or []:
        colorways = style.get("colorways") or []
        bases.append(
            {
                "style_id": style["id"],
                "code": style.get("code") or "",
                "name": style.get("name"),
                "category": style.get("category"),
                "gender": style.get("gender"),
                "size_range": style.get("size_range"),
                "views": base_views(colorways),
                "ideas": placed.get((style["id"], ""), []),
                "colours": [
                    {
                        "colorway_id": one["id"],
                        "article": one.get("article") or "",
                        "color": one.get("color"),
                        "color_code": one.get("color_code"),
                        "base_color": one.get("base_color"),
                        "rgb": one.get("rgb"),
                        "image": _main_image(one),
                        "variants": placed.get((style["id"], one["id"]), []),
                    }
                    for one in colorways
                ],
                "shelf": shelf.get(style["id"], []),
            }
        )
    return {
        "viewer": viewer_id,
        "collection": {
            "id": release["id"],
            "code": release.get("code") or "",
            "name_ru": release.get("name_ru"),
            "drop_code": release.get("drop_code"),
            "brand": release.get("brand"),
            "gender": release.get("gender"),
            "supplier": release.get("supplier"),
            "product": release.get("product"),
            "team": release.get("team") or [],
            "plm_path": f"/releases/{release['id']}",
        },
        "bases": bases,
    }


def _column_of(release: dict[str, Any], style_id: str, colorway_id: str | None) -> dict[str, Any] | None:
    """Колонка коллекции по PLM: цветомодель базы или её «Идеи» (None)."""
    for style in release.get("styles") or []:
        if style.get("id") != style_id:
            continue
        if colorway_id is None:
            return None
        for one in style.get("colorways") or []:
            if one.get("id") == colorway_id:
                return one
        raise NotInCollection("этой цветомодели нет у базы в коллекции")
    raise NotInCollection("этой базы нет в коллекции")


@dataclass(frozen=True)
class Added:
    id: int
    number: int
    name: str
    image: str


async def add_variants(
    db: AsyncSession,
    release_id: str,
    style_id: str,
    colorway_id: str | None,
    files: list[tuple[str, bytes]],
    author_id: str | None,
) -> list[Added]:
    """Каждая картинка — свой вариант в колонке цвета или в «Идеях» базы
    (вставка Ctrl+V, пачка файлов). Ключи проверяются по PLM: вариант на чужой модели или цвете
    не встанет. Картинка ложится в хранилище тем же путём, что принты."""
    release = await _release(release_id)
    colorway = _column_of(release, style_id, colorway_id)
    title = (colorway.get("color") or colorway.get("article") or "вариант") if colorway else "идея"
    already = await repo.column_size(db, release_id, style_id, colorway_id)
    # Сначала все картинки, потом карточки: не картинка в середине пачки
    # отказывает всей пачке, а не оставляет половину вариантов.
    stored_all = [(file_name, assets.store(content, file_name)) for file_name, content in files]
    added: list[Added] = []
    for index, (file_name, stored) in enumerate(stored_all, start=1):
        name = f"{title} · вариант {already + index}"
        work = {"kind": PICTURE, "image": stored.digest, "file_name": file_name}
        card, version = await repo.create_variant(
            db,
            release_id=release_id,
            style_id=style_id,
            colorway_id=colorway_id,
            name=name,
            digest=stored.digest,
            work=work,
            author_id=author_id,
        )
        added.append(Added(card.id, version.number, name, stored.digest))
    return added


async def labels(db: AsyncSession) -> list[Any]:
    return await repo.labels(db)


def _tone(tone: str) -> str:
    if tone not in TONES:
        raise LabelRefused(f"тон «{tone}» платформе неизвестен; можно: {', '.join(TONES)}")
    return tone


async def add_label(db: AsyncSession, name: str, tone: str) -> Any:
    name = " ".join(name.split())
    if not name:
        raise LabelRefused("у метки нет названия")
    if await repo.label_named(db, name) is not None:
        raise LabelRefused(f"метка «{name}» уже есть")
    return await repo.add_label(db, name, _tone(tone))


async def change_label(
    db: AsyncSession,
    label_id: int,
    *,
    name: str | None = None,
    tone: str | None = None,
    active: bool | None = None,
    position: int | None = None,
) -> Any:
    """Поправить метку. Удаления нет: погашенная остаётся на карточках, но
    новой карточке её не поставить."""
    row = await repo.label(db, label_id)
    if row is None:
        raise LabelRefused("такой метки нет")
    if name is not None:
        name = " ".join(name.split())
        if not name:
            raise LabelRefused("у метки нет названия")
        same = await repo.label_named(db, name)
        if same is not None and same.id != row.id:
            raise LabelRefused(f"метка «{name}» уже есть")
        row.name = name
    if tone is not None:
        row.tone = _tone(tone)
    if active is not None:
        row.active = active
    if position is not None:
        row.position = position
    await db.commit()
    return row


async def _variant(db: AsyncSession, reference_id: int):
    from reference_api.repositories import references as references_repo

    card = await references_repo.get(db, reference_id)
    if card is None or card.deleted_at is not None or card.plm_release_id is None:
        raise NoSuchVariant("варианта с таким номером нет")
    return card


async def set_label(db: AsyncSession, reference_id: int, label_id: int | None, by_id: str | None) -> None:
    card = await _variant(db, reference_id)
    if label_id is not None:
        row = await repo.label(db, label_id)
        if row is None:
            raise LabelRefused("такой метки нет")
        if not row.active and card.label_id != label_id:
            raise LabelRefused(f"метка «{row.name}» погашена — новой карточке её не ставят")
    if card.label_id == label_id:
        return
    await repo.set_label(db, card, label_id, by_id)


async def mark_seen(db: AsyncSession, reference_id: int, viewer_id: str | None) -> None:
    card = await _variant(db, reference_id)
    if viewer_id is None:
        return
    number = await repo.latest_number(db, card.id)
    if number is not None:
        await repo.mark_seen(db, card.id, viewer_id, number)


async def place(
    db: AsyncSession,
    release_id: str,
    style_id: str,
    colorway_id: str | None,
    ids: list[int],
) -> None:
    """Перестановка, как на доске Холста: колонка встаёт в присланном порядке,
    перенесённая из другой колонки карточка едет со всеми данными — версиями,
    автором, меткой, — меняются только база, цвет и место (Алиса 21.10).
    Взятая с полки «Отложено» возвращается в работу."""
    release = await _release(release_id)
    _column_of(release, style_id, colorway_id)
    unique = list(dict.fromkeys(ids))
    cards = {card.id: card for card in await repo.cards(db, release_id, unique)}
    if len(cards) != len(unique):
        raise NoSuchVariant("среди переставляемых есть карточка не из этой коллекции")
    await repo.place(db, [cards[i] for i in unique], style_id, colorway_id)


async def shelve(db: AsyncSession, reference_id: int, shelved: bool, by_id: str | None) -> None:
    """«Отложено» — подвал у своей базы вместо удаления; вернуть — тем же
    движением. Корзина «Референса» здесь не годится: она стирает через 30 дней."""
    card = await _variant(db, reference_id)
    if shelved and card.shelved_at is None:
        await repo.shelve(db, card, by_id)
    elif not shelved and card.shelved_at is not None:
        await repo.unshelve(db, card)

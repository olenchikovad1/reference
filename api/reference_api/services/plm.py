"""Чтение каталога hub PLM от имени Референса (US-0883, решение 0018).

Канал — машинный вход plm (`/api/machine/...`) с ключом приложения. Справочники
в свою базу не копируются: ответы живут у вызывающего. Cosmic не зовём.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

__all__ = [
    "Drop",
    "Colorway",
    "Color",
    "PlmUnavailable",
    "PlmRefused",
    "list_drops",
    "list_colorways",
    "list_colors",
    "colorway_card",
    "enrich_colorways",
    "fetch_image",
    "NO_FRAMES",
]

NO_FRAMES = "у изделия нет кадров для работы"

TIMEOUT_SECONDS = 10.0
#: Повторы только на сетевых/5xx. 401/403 не долбим.
MAX_ATTEMPTS = 3


class PlmUnavailable(Exception):
    """plm не ответил или недоступен — приложение само продолжает жить."""


class PlmRefused(Exception):
    """Ключ не принят или маршрут запрещён — повтор бесполезен."""


@dataclass(frozen=True)
class Drop:
    code: str
    season: str | None
    subseason: str | None
    category: str | None
    description: str | None
    ship_week_uz: int | None
    ship_week_cn: int | None
    intake_week: int | None
    exit_week: int | None
    active: bool
    position: int


@dataclass(frozen=True)
class Colorway:
    id: str
    article: str
    title: str
    style_id: str
    style_code: str
    color: str | None
    base_color: str | None
    rgb: tuple[int, int, int] | None
    gender: str | None
    image: str | None
    suppliers: tuple[str, ...]


@dataclass(frozen=True)
class Color:
    id: str
    code: str | None
    code_short: str | None
    name: str | None
    name_ru: str | None
    red: int | None
    green: int | None
    blue: int | None


def _base(url: str) -> str:
    return url.rstrip("/")


async def _get(
    base_url: str,
    key: str,
    path: str,
    *,
    params: dict[str, Any] | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> Any:
    if not base_url or not key:
        raise PlmUnavailable("plm не настроен: нет адреса или ключа машинного входа")
    url = f"{_base(base_url)}{path}"
    headers = {"Authorization": f"Bearer {key}"}
    last: Exception | None = None
    for attempt in range(MAX_ATTEMPTS):
        try:
            async with httpx.AsyncClient(transport=transport, timeout=TIMEOUT_SECONDS) as client:
                response = await client.get(url, headers=headers, params=params)
        except httpx.HTTPError as failure:
            last = failure
            continue
        if response.status_code in (401, 403):
            raise PlmRefused(f"plm отказал ({response.status_code}): ключ не принят")
        if response.status_code >= 500:
            last = PlmUnavailable(f"plm ответил {response.status_code}")
            continue
        if response.status_code != 200:
            raise PlmRefused(f"plm ответил {response.status_code}: {response.text[:200]}")
        return response.json()
    raise PlmUnavailable(f"plm недоступен: {type(last).__name__ if last else 'unknown'}")


def _drop(row: dict[str, Any]) -> Drop:
    return Drop(
        code=str(row["code"]),
        season=row.get("season"),
        subseason=row.get("subseason"),
        category=row.get("category"),
        description=row.get("description"),
        ship_week_uz=row.get("ship_week_uz"),
        ship_week_cn=row.get("ship_week_cn"),
        intake_week=row.get("intake_week"),
        exit_week=row.get("exit_week"),
        active=bool(row.get("active", True)),
        position=int(row.get("position") or 0),
    )


def _rgb(value: Any) -> tuple[int, int, int] | None:
    if not value or not isinstance(value, list) or len(value) != 3:
        return None
    return int(value[0]), int(value[1]), int(value[2])


def _colorway(row: dict[str, Any]) -> Colorway:
    return Colorway(
        id=str(row["id"]),
        article=str(row.get("article") or ""),
        title=str(row.get("title") or ""),
        style_id=str(row.get("style_id") or ""),
        style_code=str(row.get("style_code") or ""),
        color=row.get("color"),
        base_color=row.get("base_color"),
        rgb=_rgb(row.get("rgb")),
        gender=row.get("gender"),
        image=row.get("image"),
        suppliers=tuple(row.get("suppliers") or ()),
    )


async def list_drops(
    base_url: str,
    key: str,
    *,
    active_only: bool = True,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[Drop]:
    data = await _get(
        base_url,
        key,
        "/api/machine/drops",
        params={"active_only": str(active_only).lower()},
        transport=transport,
    )
    return [_drop(row) for row in (data.get("items") or data)]


async def list_colorways(
    base_url: str,
    key: str,
    *,
    drop: str | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[Colorway]:
    params: dict[str, Any] = {}
    if drop:
        params["drop"] = drop
    data = await _get(base_url, key, "/api/machine/colorways", params=params or None, transport=transport)
    return [_colorway(row) for row in (data.get("items") or data)]


async def list_colors(
    base_url: str,
    key: str,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[Color]:
    data = await _get(base_url, key, "/api/machine/colors", transport=transport)
    items = data.get("items") or data
    return [
        Color(
            id=str(row["id"]),
            code=row.get("code"),
            code_short=row.get("code_short"),
            name=row.get("name"),
            name_ru=row.get("name_ru"),
            red=row.get("red"),
            green=row.get("green"),
            blue=row.get("blue"),
        )
        for row in items
    ]


async def colorway_card(
    base_url: str,
    key: str,
    colorway_id: str,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    """Карточка цветомодели целиком — паспорт и вкладки как отдаёт plm."""
    data = await _get(base_url, key, f"/api/machine/colorways/{colorway_id}", transport=transport)
    if not isinstance(data, dict):
        raise PlmRefused("plm вернул карточку не объектом")
    return data


async def enrich_colorways(db: AsyncSession, items: list[Colorway]) -> list[dict[str, Any]]:
    """Добавить к ЦМ plm свою связь с кадрами и can_work — без копирования каталога."""
    from reference_api.repositories import plm_links as links_repo
    from reference_api.repositories import products as products_repo

    codes = await links_repo.product_codes(db, [c.style_code for c in items if c.style_code])
    out: list[dict[str, Any]] = []
    for c in items:
        product = codes.get(c.style_code) if c.style_code else None
        can = bool(product and products_repo.load_product(product) is not None)
        out.append(
            {
                "id": c.id,
                "article": c.article,
                "title": c.title,
                "style_id": c.style_id,
                "style_code": c.style_code,
                "color": c.color,
                "base_color": c.base_color,
                "rgb": list(c.rgb) if c.rgb else None,
                "gender": c.gender,
                # Ключ картинки plm — только для выбора; холст на кадрах тома.
                "image": c.image,
                "suppliers": list(c.suppliers),
                "product_code": product,
                "can_work": can,
                "reason": None if can else NO_FRAMES,
            }
        )
    return out


async def fetch_image(
    base_url: str,
    key: str,
    image_key: str,
    preset: str,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> tuple[bytes, str]:
    """Thumb/preview из машинного входа plm. Оригинал не запрашиваем."""
    if preset not in ("thumb", "preview"):
        raise PlmRefused("доступны только thumb и preview")
    if not base_url or not key:
        raise PlmUnavailable("plm не настроен: нет адреса или ключа машинного входа")
    url = f"{_base(base_url)}/api/machine/images/{image_key}/{preset}"
    headers = {"Authorization": f"Bearer {key}"}
    try:
        async with httpx.AsyncClient(transport=transport, timeout=TIMEOUT_SECONDS) as client:
            response = await client.get(url, headers=headers)
    except httpx.HTTPError as failure:
        raise PlmUnavailable(f"plm недоступен: {type(failure).__name__}") from failure
    if response.status_code in (401, 403):
        raise PlmRefused(f"plm отказал ({response.status_code}): ключ не принят")
    if response.status_code == 404:
        raise PlmRefused("картинки нет")
    if response.status_code != 200:
        raise PlmUnavailable(f"plm ответил {response.status_code}")
    media = response.headers.get("content-type") or "image/jpeg"
    return response.content, media


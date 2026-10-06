"""Люди приложения: снимок из платформы (план 072, US-0508).

Роли назначают в платформе — наборы прав «Дизайнер», «Редактор»,
«Суперредактор», «Технолог»; приложение их не выдаёт (запрет 3), а знает по
снимку. Путь платформы — её решение 0025: GET /applications/{код}/people с
удостоверением приложения, весь снимок сразу. Событий ядро не публикует, поэтому
снимок перечитывается по расписанию (schedulers/people.py).
"""

import logging
from dataclasses import dataclass

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.config import settings
from reference_api.models.people import Person
from reference_api.repositories import people as repo

log = logging.getLogger("reference.people")

TIMEOUT_SECONDS = 10.0


async def refresh(
    db: AsyncSession, core_url: str | None, credential: str | None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> bool:
    """Перечитать снимок. Удалось — True. Отказ, сетевая ошибка, нет ключа —
    False, и ПРЕЖНИЙ снимок остаётся: платформа ненадолго недоступна, а выбор
    исполнителя работать обязан. Неудача видна в журнале."""
    if not (core_url and credential):
        log.warning("люди не перечитаны: нет PLATFORM_CORE_URL или PLATFORM_CREDENTIAL")
        return False
    url = f"{core_url.rstrip('/')}/applications/{settings().platform_app_code}/people"
    try:
        async with httpx.AsyncClient(transport=transport, timeout=TIMEOUT_SECONDS) as client:
            r = await client.get(url, headers={"Authorization": f"Bearer {credential}"})
    except httpx.HTTPError as failure:
        log.warning("люди не перечитаны: ядро не ответило — %s; снимок прежний", type(failure).__name__)
        return False
    if r.status_code != httpx.codes.OK:
        # 404 — на всё: нет ключа, чужой, отозванный, приложение не заведено.
        log.warning("люди не перечитаны: ядро ответило %s; снимок прежний", r.status_code)
        return False
    # Поля ответа могут добавиться (договор платформы) — берём только свои.
    rows = [{k: p.get(k) for k in ("id", "display_name", "kind", "organization_id", "right_sets")}
            for p in r.json().get("people", [])]
    await repo.replace(db, rows)
    log.info("люди перечитаны: %d", len(rows))
    return True


async def listing(db: AsyncSession, right_set: str | None = None) -> list[Person]:
    """Кто сейчас с доступом — для выбора исполнителя и согласующих."""
    return await repo.listing(db, right_set)


#: Субъект стенда без платформы (решение 0006): у него нет имени в снимке
#: людей, и «имя ещё не пришло» про него неправда — оно не придёт никогда.
STAND_SUBJECT_ID = "stand"
STAND_SUBJECT_NAME = "стенд без входа"


async def names_of(db: AsyncSession, ids: list[str]) -> dict[str, str]:
    """Имена для показа «кто сделал» — в том числе тех, у кого доступ забрали.
    ФИО из таблицы ролей (решение 0016) — поверх имени из платформы: в
    работе людей называют по ФИО, а не по нику."""
    wanted = {i for i in ids if i}
    names = await repo.names(db, sorted(wanted - {STAND_SUBJECT_ID}))
    if STAND_SUBJECT_ID in wanted:
        names[STAND_SUBJECT_ID] = STAND_SUBJECT_NAME
    for p in await repo.app_people(db):
        if p.subject_id in wanted:
            names[p.subject_id] = p.full_name
    return names


async def name_of(db: AsyncSession, subject_id: str) -> str | None:
    return (await names_of(db, [subject_id])).get(subject_id)


#: Роли в согласовании (решение 0016) — порядок показа в выборе.
ROLES = {"designer": "дизайнер", "editor": "редактор", "chief": "главный редактор"}


class BadPerson(ValueError):
    """Роль не из списка или пустое ФИО — отказ, а не запись."""


@dataclass(frozen=True)
class Member:
    """Человек приложения: снимок платформы и своя строка ролей вместе."""

    id: str
    #: ФИО из таблицы ролей; нет — имя из платформы.
    name: str
    full_name: str | None
    role: str | None
    #: Есть ли сейчас доступ к «Референсу» по снимку платформы. У стендового
    #: субъекта и у людей, заведённых на стенде руками, — только на стенде.
    access: bool


def _has_access(sid: str, snapshot) -> bool:
    """Доступ — по снимку платформы. На стенде без платформы доступ есть и у
    стендового субъекта, и у людей, заведённых на стенде (id stand-…):
    платформа их не знает, и «нет доступа» у каждого было бы шумом."""
    if sid in snapshot or sid == STAND_SUBJECT_ID:
        return True
    return settings().without_platform and sid.startswith("stand-")


async def everyone(db: AsyncSession) -> list[Member]:
    """Все люди приложения — и с доступом, и с ролью: друг друга знают все
    (решение 0016). По ФИО."""
    with_role = {p.subject_id: p for p in await repo.app_people(db)}
    snapshot = {p.id: p for p in await repo.listing(db)}
    out = []
    for sid in set(with_role) | set(snapshot):
        # sid взят из объединения ключей: нет роли — значит есть в снимке.
        r = with_role.get(sid)
        out.append(Member(sid, r.full_name if r else snapshot[sid].display_name, r.full_name if r else None,
                          r.role if r else None, _has_access(sid, snapshot)))
    return sorted(out, key=lambda m: m.name.lower())


async def set_role(db: AsyncSession, subject_id: str, full_name: str, role: str, by: str | None) -> Member:
    name = " ".join(full_name.split())
    if role not in ROLES:
        raise BadPerson(f"роли «{role}» нет; есть: {', '.join(ROLES.values())}")
    if not name:
        raise BadPerson("нужно ФИО или ФИ")
    await repo.put_app_person(db, subject_id, name, role, by)
    return next(m for m in await everyone(db) if m.id == subject_id)


async def members_of(db: AsyncSession, ids: list[str]) -> dict[str, Member]:
    """Люди по id — для исполнителей на карточках. Кого нет ни в ролях, ни в
    снимке — по последнему известному имени, без доступа."""
    known = {m.id: m for m in await everyone(db)}
    rest = [i for i in ids if i and i not in known]
    names = await names_of(db, rest)
    for i in rest:
        known[i] = Member(i, names.get(i, i), None, None, _has_access(i, {}))
    return {i: known[i] for i in ids if i}

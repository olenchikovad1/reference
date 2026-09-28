"""Согласование: статусы и чей ход (план 075, US-0510).

Статус — у референса: черновик → на согласовании → на доработке →
согласован → окончательно принят. Переход делает только положенная роль в
согласовании (решение 0016): отправляет исполнитель, возвращает и принимает
редактор или главный редактор, окончательно принимает главный редактор.

Чей ход — вычисляется из статуса и ролей, отдельным полем не хранится (И-8):
на согласовании — у всех редакторов, кто первым решил — тот и решил, у
остальных задача уходит сама, потому что сменился статус; на доработке — у
исполнителя; согласованный — у главных редакторов.
"""

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.repositories import people as people_repo
from reference_api.repositories import references as cards
from reference_api.repositories import review as repo

STATUS_NAMES = {
    "draft": "черновик",
    "review": "на согласовании",
    "rework": "на доработке",
    "approved": "согласован",
    "final": "окончательно принят",
}

#: Переход: из каких статусов, в какой, какой роли. «executor» — исполнитель
#: этого референса, остальное — роль в таблице ролей.
STEPS = {
    "submit": ({"draft", "rework"}, "review", {"executor"}),
    "return": ({"review"}, "rework", {"editor", "chief"}),
    "approve": ({"review"}, "approved", {"editor", "chief"}),
    "approve-final": ({"approved"}, "final", {"chief"}),
}


class WrongStatus(ValueError):
    """Из этого статуса такого перехода нет — 409."""


class NotYourStep(PermissionError):
    """Переход не для этой роли — 403."""


class NoComment(ValueError):
    """Вернуть без замечания нельзя — 422."""


class NoSuchReference(LookupError):
    pass


async def _roles(db: AsyncSession, card, who: str | None) -> set[str]:
    out = set()
    if who and who == card.executor_id:
        out.add("executor")
    person = await people_repo.app_person(db, who) if who else None
    if person:
        out.add(person.role)
    return out


async def can(db: AsyncSession, card, who: str | None) -> list[str]:
    """Что смотрящему доступно сейчас: переходы — по статусу и ролям, и
    «remark» — ставить замечания (редактор и главный, US-0511)."""
    roles = await _roles(db, card, who)
    out = [s for s, (src, _, need) in STEPS.items() if card.status in src and roles & need]
    return out + (["remark"] if roles & {"editor", "chief"} else [])


async def can_say(db: AsyncSession, card, row, who: str | None) -> list[str]:
    """Что смотрящему можно сказать в ветке этого замечания — кнопки окна."""
    roles = await _roles(db, card, who)
    reviewer = bool(roles & {"editor", "chief"}) or (who is not None and who == row.author_id)
    out = ["reply"] if roles else []
    if "executor" in roles and row.status == "open":
        out.append("fixed")
    if reviewer and row.status == "fixed":
        out += ["accepted", "rejected"]
    return out


async def step(db: AsyncSession, reference_id: int, action: str, who: str | None, comment: str | None = None) -> None:
    card = await cards.get(db, reference_id)
    if card is None:
        raise NoSuchReference("референса с таким номером нет")
    src, to, need = STEPS[action]
    if card.status not in src:
        raise WrongStatus(f"из статуса «{STATUS_NAMES[card.status]}» так нельзя")
    if not (await _roles(db, card, who)) & need:
        raise NotYourStep("этот шаг — не для вашей роли в согласовании")
    text = " ".join((comment or "").split()) or None
    if action == "return" and not text:
        raise NoComment("вернуть на доработку можно только с замечанием")
    await repo.move(db, reference_id, to, await repo.last_number(db, reference_id), who, text)


async def after_new_version(db: AsyncSession, reference_id: int, number: int, who: str | None) -> None:
    """Правка согласованного — новая версия, и статус уходит в черновик:
    утверждено было одно, правится другое."""
    card = await cards.get(db, reference_id)
    if card is not None and card.status in {"approved", "final"}:
        await repo.move(db, reference_id, "draft", number, who, "правка согласованного")


@dataclass(frozen=True)
class Task:
    id: int
    name: str
    status: str
    reason: str


async def tasks(db: AsyncSession, who: str | None) -> tuple[list[Task], list[Task]]:
    """«Мои задачи» — вычислением из статусов и ролей (И-8): что ждёт именно
    меня, и что я отдал и жду от других."""
    person = await people_repo.app_person(db, who) if who else None
    role = person.role if person else None
    live = await repo.in_statuses(db, ["review", "rework", "approved"])
    returns = await repo.last_returns(db, [c.id for c in live if c.status == "rework"])
    open_remarks = await repo.open_counts(db, [c.id for c in live if c.status == "rework"])
    mine, waiting = [], []
    for c in live:
        if c.status == "review" and role in {"editor", "chief"}:
            mine.append(Task(c.id, c.name, c.status, "на согласовании"))
        elif c.status == "rework" and c.executor_id == who:
            e, n = returns.get(c.id), open_remarks.get(c.id, 0)
            head = f"вернули с {n} {_remarks_word(n)}" if n else "вернули"
            mine.append(Task(c.id, c.name, c.status, f"{head}: «{e.comment}»" if e and e.comment else head))
        elif c.status == "approved" and role == "chief":
            mine.append(Task(c.id, c.name, c.status, "согласован — ждёт окончательного принятия"))
        elif c.executor_id == who and c.status in {"review", "approved"}:
            waiting.append(Task(c.id, c.name, c.status,
                                "ждёт согласования" if c.status == "review" else "ждёт окончательного принятия"))
    return mine, waiting


async def events(db: AsyncSession, reference_id: int):
    return await repo.events(db, reference_id)


def _remarks_word(n: int) -> str:
    """«с 1 замечанием», «с 2 замечаниями» — творительный падеж."""
    return "замечанием" if n % 10 == 1 and n % 100 != 11 else "замечаниями"


# --- Замечания (US-0511) -------------------------------------------------

#: Открытые первыми: редактор видит их сразу, даже если референс отправили
#: с открытыми.
_ORDER = {"open": 0, "fixed": 1, "accepted": 2}


class BadRemark(ValueError):
    """Пустой текст, точка вне кадра, неизвестный вид сообщения — 422."""


async def add_remark(db: AsyncSession, reference_id: int, who: str | None, side: str, x: float, y: float,
                     text: str, element_id: str | None = None):
    """Замечание ставит редактор или главный редактор — нажатием на слой или
    на место изделия. Принадлежит последней версии."""
    card = await cards.get(db, reference_id)
    if card is None:
        raise NoSuchReference("референса с таким номером нет")
    if not (await _roles(db, card, who)) & {"editor", "chief"}:
        raise NotYourStep("замечания ставит редактор")
    body = " ".join((text or "").split())
    if not body or not (0 <= x <= 1 and 0 <= y <= 1):
        raise BadRemark("нужен текст замечания и точка на изделии")
    number = await repo.last_number(db, reference_id)
    name = None
    if element_id:
        version = await cards.version(db, reference_id, number)
        work = (version.work or {}) if version else {}
        elements = (work.get("composition") or {}).get("elements") or []
        el = next((e for e in elements if e.get("id") == element_id), None)
        if el:
            name = el.get("name") or (f"«{el.get('text')}»" if el.get("text") else None)
    return await repo.add_remark(db, reference_id=reference_id, number=number, side=side, element_id=element_id,
                                 element_name=name, x=x, y=y, text=body, author_id=who, status="open")


async def say(db: AsyncSession, reference_id: int, remark_id: int, who: str | None, kind: str, text: str | None) -> None:
    """Сообщение в ветку. Ответить может любой с ролью; «исправлено» —
    исполнитель; «принято» и «нет, не то» — автор замечания или редактор."""
    card = await cards.get(db, reference_id)
    row = await repo.remark(db, remark_id)
    if card is None or row is None or row.reference_id != reference_id:
        raise NoSuchReference("такого замечания нет")
    roles = await _roles(db, card, who)
    body = " ".join((text or "").split()) or None
    number = await repo.last_number(db, reference_id)
    reviewer = bool(roles & {"editor", "chief"}) or (who is not None and who == row.author_id)
    if kind == "reply":
        if not roles:
            raise NotYourStep("ответить может участник согласования")
        if not body:
            raise BadRemark("пустой ответ")
        await repo.say(db, remark_id, kind, body, who, number)
    elif kind == "fixed":
        if "executor" not in roles:
            raise NotYourStep("«исправлено» отмечает исполнитель")
        if row.status != "open":
            raise WrongStatus("отметить «исправлено» можно у открытого замечания")
        await repo.say(db, remark_id, kind, body, who, number, status="fixed", fixed_in=number)
    elif kind in {"accepted", "rejected"}:
        if not reviewer:
            raise NotYourStep("принимает исправление автор замечания или редактор")
        if row.status != "fixed":
            raise WrongStatus("принять или отклонить можно исправленное")
        if kind == "accepted":
            await repo.say(db, remark_id, kind, body, who, number, status="accepted")
        else:
            await repo.say(db, remark_id, kind, body, who, number, status="open", fixed_in=None)
    else:
        raise BadRemark(f"вида сообщения «{kind}» нет")


async def remarks(db: AsyncSession, reference_id: int):
    rows = sorted(await repo.remarks_of(db, reference_id), key=lambda r: (_ORDER[r.status], r.id))
    return rows, await repo.messages_of(db, [r.id for r in rows])


async def card_of(db: AsyncSession, reference_id: int):
    return await cards.get(db, reference_id)

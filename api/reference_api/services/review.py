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
    """Какие переходы смотрящему доступны сейчас — по статусу и его ролям."""
    roles = await _roles(db, card, who)
    return [s for s, (src, _, need) in STEPS.items() if card.status in src and roles & need]


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
    mine, waiting = [], []
    for c in live:
        if c.status == "review" and role in {"editor", "chief"}:
            mine.append(Task(c.id, c.name, c.status, "на согласовании"))
        elif c.status == "rework" and c.executor_id == who:
            e = returns.get(c.id)
            mine.append(Task(c.id, c.name, c.status, f"вернули: «{e.comment}»" if e and e.comment else "вернули на доработку"))
        elif c.status == "approved" and role == "chief":
            mine.append(Task(c.id, c.name, c.status, "согласован — ждёт окончательного принятия"))
        elif c.executor_id == who and c.status in {"review", "approved"}:
            waiting.append(Task(c.id, c.name, c.status,
                                "ждёт согласования" if c.status == "review" else "ждёт окончательного принятия"))
    return mine, waiting


async def events(db: AsyncSession, reference_id: int):
    return await repo.events(db, reference_id)

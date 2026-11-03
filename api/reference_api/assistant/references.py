"""Референсы для помощника: витрина с отбором и карточка целиком (US-0896)."""

from typing import Any

from platform_client import Action
from platform_client.assistant_tools import ToolCall, ToolRefused, right
from platform_client.rights import RequiredRight
from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.assistant import tools
from reference_api.services import drops, people, review
from reference_api.services import references as service

STATUSES = ["draft", "review", "rework", "approved", "final", "rejected"]


@tools.tool(
    "references",
    "Референсы с витрины, свежие первыми: номер, название, статус согласования, "
    "дропы, цвет, вид одежды, адресат, исполнитель, на обсуждении ли. Отбор — "
    "по дропу (часть названия), статусу, исполнителю («me» — я) и словам названия.",
    requires=right("references", Action.VIEW),
    parameters={
        "type": "object",
        "properties": {
            "drop": {"type": "string", "description": "часть названия дропа, например «Зима»"},
            "status": {"type": "string", "enum": STATUSES},
            "executor": {"type": "string", "description": "«me» — мои; иначе часть ФИО"},
            "q": {"type": "string", "description": "слова названия референса"},
            "limit": {"type": "integer", "minimum": 1, "maximum": 500, "default": 100},
        },
    },
)
async def references(call: ToolCall) -> list[dict[str, Any]]:
    db: AsyncSession = call.context
    args = call.arguments
    rows = await service.latest(db)
    places = await drops.colour_models_of(db, [c.colour_model_id for c, _ in rows if c.colour_model_id])
    executors = await people.members_of(db, [c.executor_id for c, _ in rows if c.executor_id])
    agenda = await review.agenda_of(db, [c.id for c, _ in rows])
    want_drop = (args.get("drop") or "").strip().lower()
    want_who = (args.get("executor") or "").strip().lower()
    want_words = (args.get("q") or "").strip().lower()
    out = []
    for card, _version in rows:
        place = places.get(card.colour_model_id) if card.colour_model_id else None
        who = executors.get(card.executor_id or "")
        if args.get("status") and card.status != args["status"]:
            continue
        if want_drop and not any(want_drop in d.lower() for d in (place.drops if place else [])):
            continue
        if want_who == "me" and card.executor_id != call.subject.id:
            continue
        if want_who and want_who != "me" and not (who and want_who in who.name.lower()):
            continue
        if want_words and want_words not in card.name.lower():
            continue
        out.append({
            "id": card.id,
            "name": card.name,
            "status": card.status,
            "drops": place.drops if place else [],
            "colour": place.colour_code if place else None,
            "category": place.category if place else None,
            "audience": place.audience if place else None,
            "executor": who.name if who else None,
            "on_agenda": [i.reason for i in agenda.get(card.id, [])],
        })
        if len(out) >= int(args.get("limit") or 100):
            break
    return out


@tools.tool(
    "reference",
    "Один референс по номеру: статус и путь согласования, версии, исполнитель, "
    "теги, замечания, повестка и доступные действия. Проверки — отчёт браузера "
    "из сохранённой версии, не новый серверный расчёт; у старых версий отчёта может не быть.",
    requires=right("references", Action.VIEW),
    parameters={
        "type": "object",
        "properties": {"id": {"type": "integer", "description": "номер референса"}},
        "required": ["id"],
    },
)
async def reference(call: ToolCall) -> dict[str, Any]:
    db: AsyncSession = call.context
    reference_id = int(call.arguments.get("id", 0))
    opened = await service.open_card(db, reference_id)
    if opened is None:
        raise ToolRefused(f"референса №{reference_id} нет")
    card, versions, fork = opened
    place = (await drops.colour_models_of(db, [card.colour_model_id])).get(card.colour_model_id) \
        if card.colour_model_id else None
    events = await review.events(db, card.id)
    people_ids = sorted({e.by_id for e in events if e.by_id} | ({card.executor_id} if card.executor_id else set()))
    who = await people.members_of(db, people_ids)
    remarks, _messages = await review.remarks(db, card.id)
    tags = await service.tags_of(db, card.id)
    authors = await people.names_of(db, [version.author_id for version in versions if version.author_id])
    last_work = versions[-1].work or {}
    report = last_work.get("checks")
    if not isinstance(report, dict):
        report = {"source": "unavailable", "items": None,
                  "reason": "В этой версии не сохранён отчёт проверок. Это не означает, что нарушений нет."}
    allowed = []
    for action in await review.can(db, card, call.subject.id):
        required = (RequiredRight("review", "approve-final", "function") if action == "approve-final" else
                    right("references", Action.WRITE) if action in {"submit", "recall"} else
                    right("review", Action.WRITE))
        if call.subject.has(required):
            allowed.append(action)
    can_review = call.subject.has(right("review", Action.VIEW))
    return {
        "id": card.id,
        "name": card.name,
        "status": card.status,
        "versions": len(versions),
        "version_history": [{"number": version.number, "saved_at": version.created_at.isoformat(),
                             "author_id": version.author_id, "author": authors.get(version.author_id or ""),
                             "auto_reason": version.auto_reason} for version in versions],
        "checks": report,
        "last_saved_at": versions[-1].created_at.isoformat(),
        "forked_from": {"id": fork.reference_id, "version": fork.number} if fork else None,
        "drops": place.drops if place else [],
        "colour": place.colour_code if place else None,
        "category": place.category if place else None,
        "executor": who[card.executor_id].name if card.executor_id in who else None,
        "status_path": [
            {"from": e.from_status, "to": e.to_status, "version": e.number,
             "by": who[e.by_id].name if e.by_id in who else None, "comment": e.comment,
             "at": e.at.isoformat(), "bot_name": e.bot_name}
            for e in events
        ],
        "remarks": [{"id": r.id, "status": r.status, "text": r.text} for r in remarks] if can_review else [],
        "remarks_available": can_review,
        "agenda": [i.reason for i in (await review.agenda_of(db, [card.id])).get(card.id, [])],
        "tags": sorted(tags.own),
        "i_can": allowed,
    }

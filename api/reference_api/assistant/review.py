"""Согласование словами для помощника (US-0897): те же шаги, права и отказы,
что у кнопок полосы решений, — и путь согласования помнит, что шаг сделал бот.

Права — те же, что у маршрутов этих шагов: отправить и отозвать — запись
референсов, решения редактора — запись согласования, окончательное принятие —
функция. Поэтому инструментов несколько: у одного инструмента одно право.
"""

from typing import Any

from platform_client import Action
from platform_client.assistant_tools import ToolCall, ToolRefused, right
from platform_client.rights import RequiredRight
from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.assistant import tools
from reference_api.services import references as cards
from reference_api.services import review

# Отказы предметной области — словами, как на экране.
REFUSALS = (review.NoSuchReference, review.WrongStatus, review.NotYourStep, review.NoComment,
            review.BadRemark)

ID = {"type": "integer", "description": "номер референса"}


async def _step(call: ToolCall, action: str) -> dict[str, Any]:
    db: AsyncSession = call.context
    reference_id = int(call.arguments.get("id", 0))
    try:
        await review.step(db, reference_id, action, call.subject.id, call.arguments.get("comment"),
                          call.subject.bot_name)
    except REFUSALS as refusal:
        raise ToolRefused(str(refusal)) from None
    card = await review.card_of(db, reference_id)
    return {"id": reference_id, "status": card.status if card else None}


@tools.tool(
    "designer_step",
    "Шаг дизайнера: «submit» — отправить на согласование, «recall» — отозвать.",
    requires=right("references", Action.WRITE),
    parameters={"type": "object", "required": ["id", "action"],
                "properties": {"id": ID, "action": {"type": "string", "enum": ["submit", "recall"]}}},
)
async def designer_step(call: ToolCall) -> dict[str, Any]:
    return await _step(call, str(call.arguments.get("action")))


@tools.tool(
    "review_decision",
    "Решение редактора: «approve» — согласовать, «return» — на доработку, "
    "«unapprove» — отменить согласование, «reject» — забраковать, «revive» — вернуть "
    "в работу. Для return, unapprove, reject, revive причина обязательна — в comment.",
    requires=right("review", Action.WRITE),
    parameters={"type": "object", "required": ["id", "action"],
                "properties": {"id": ID,
                               "action": {"type": "string",
                                          "enum": ["approve", "return", "unapprove", "reject", "revive"]},
                               "comment": {"type": "string", "description": "причина или замечание"}}},
)
async def review_decision(call: ToolCall) -> dict[str, Any]:
    return await _step(call, str(call.arguments.get("action")))


@tools.tool(
    "approve_final",
    "Принять окончательно: дальше — только техпакет на фабрику. Только главный редактор.",
    requires=RequiredRight("review", "approve-final", "function"),
    parameters={"type": "object", "required": ["id"], "properties": {"id": ID}},
)
async def approve_final(call: ToolCall) -> dict[str, Any]:
    return await _step(call, "approve-final")


@tools.tool(
    "remark",
    "Замечание к референсу словами — на всё изделие, без точки на нём. Ставит "
    "редактор или главный; исполнитель увидит его в обсуждении.",
    requires=right("review", Action.WRITE),
    parameters={"type": "object", "required": ["id", "text"],
                "properties": {"id": ID, "text": {"type": "string"}}},
)
async def remark(call: ToolCall) -> dict[str, Any]:
    db: AsyncSession = call.context
    try:
        row = await review.add_remark(db, int(call.arguments.get("id", 0)), call.subject.id, None, None, None,
                                      str(call.arguments.get("text", "")))
    except REFUSALS as refusal:
        raise ToolRefused(str(refusal)) from None
    return {"remark": row.id}


@tools.tool(
    "propose_for_discussion",
    "Вынести референс на встречу: попадёт в повестку с поводом; статус не меняется.",
    requires=right("review", Action.VIEW),
    parameters={"type": "object", "required": ["id", "reason"],
                "properties": {"id": ID, "reason": {"type": "string", "description": "что обсудить"}}},
)
async def propose_for_discussion(call: ToolCall) -> str:
    db: AsyncSession = call.context
    try:
        await review.propose(db, int(call.arguments.get("id", 0)), call.subject.id,
                             str(call.arguments.get("reason", "")))
    except REFUSALS as refusal:
        raise ToolRefused(str(refusal)) from None
    return "на повестке"


@tools.tool(
    "move_to_drop",
    "Перенести референс в другой дроп: на цветомодель той же модели в ассортименте "
    "этого дропа. Модели в дропе нет — отказ с причиной.",
    requires=right("references", Action.WRITE),
    parameters={"type": "object", "required": ["id", "drop_id"],
                "properties": {"id": ID, "drop_id": {"type": "integer"}}},
)
async def move_to_drop(call: ToolCall) -> str:
    db: AsyncSession = call.context
    try:
        await cards.move_to_drop(db, int(call.arguments.get("id", 0)), int(call.arguments.get("drop_id", 0)))
    except (cards.NoSuchReference, cards.NotInDrop) as refusal:
        raise ToolRefused(str(refusal)) from None
    return "перенесён"

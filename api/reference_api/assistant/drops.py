"""Дропы для помощника: список, ассортимент и доска одобрения (US-0896)."""

from typing import Any

from platform_client import Action
from platform_client.assistant_tools import ToolCall, ToolRefused, right
from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.assistant import tools
from reference_api.services import drops as service
from reference_api.services import library

DROP_ID = {
    "type": "object",
    "properties": {"drop_id": {"type": "integer", "description": "номер дропа из инструмента drops"}},
    "required": ["drop_id"],
}


@tools.tool(
    "drops",
    "Дропы: номер, название, сезон, даты выхода, адресат, тема, погашен ли.",
    requires=right("drops", Action.VIEW),
    parameters={
        "type": "object",
        "properties": {"active_only": {"type": "boolean", "default": False,
                                       "description": "только действующие"}},
    },
)
async def drops(call: ToolCall) -> list[dict[str, Any]]:
    db: AsyncSession = call.context
    return [
        {"id": d.id, "name": d.name, "season": d.season, "release_from": d.release_from.isoformat(),
         "release_to": d.release_to.isoformat(), "audience": d.audience, "theme": d.theme,
         "retired": d.retired}
        for d in await service.drops(db, bool(call.arguments.get("active_only")))
    ]


@tools.tool(
    "drop_assortment",
    "Ассортимент дропа: модели и их цвета, на каждой цветомодели — сколько "
    "референсов нарисовано (0 — ещё не нарисовано).",
    requires=right("drops", Action.VIEW),
    parameters=DROP_ID,
)
async def drop_assortment(call: ToolCall) -> dict[str, Any]:
    db: AsyncSession = call.context
    drop_id = int(call.arguments.get("drop_id", 0))
    try:
        m = await service.matrix(db, drop_id)
    except service.DropNotFound:
        raise ToolRefused(f"дропа №{drop_id} нет") from None
    return {
        "drop": m["drop"].name,
        "models": [
            {"code": row["model"].code, "name": row["model"].name,
             "colours": {code: cell["references"] for code, cell in row["cells"].items()}}
            for row in m["rows"]
        ],
    }


@tools.tool(
    "drop_board",
    "Принты и надписи, предложенные в дроп, с решением: одобрено, отклонено (с "
    "причиной) или ещё не решено; отдельно — попавшее в дроп через референсы без "
    "предложения.",
    requires=right("drops", Action.VIEW),
    parameters=DROP_ID,
)
async def drop_board(call: ToolCall) -> dict[str, Any]:
    db: AsyncSession = call.context
    drop_id = int(call.arguments.get("drop_id", 0))
    items, via = await library.board(db, drop_id)
    return {
        "proposed": [{"kind": i.kind, "title": i.title, "status": i.status, "reason": i.reason}
                     for i in items],
        "via_references": [{"kind": v.kind, "title": v.title, "references": v.references} for v in via],
    }

"""Принты и решения по дропу для помощника — тот же набор, что на экране."""
from typing import Any

from platform_client import Action
from platform_client.assistant_tools import ToolCall, ToolRefused, right
from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.assistant import tools
from reference_api.config import settings
from reference_api.services import library


@tools.tool(
    "prints",
    "Принты библиотеки: название, теги, где использован и решения по дропам. "
    "Поиск по названию/тегам; status применяется только с drop_id. Только thumb/preview, без оригиналов.",
    requires=right("prints", Action.VIEW),
    parameters={"type": "object", "properties": {
        "q": {"type": "string", "maxLength": 200},
        "drop_id": {"type": "integer", "minimum": 1},
        "status": {"type": "string", "enum": ["proposed", "approved", "rejected", "not_proposed"]},
        "limit": {"type": "integer", "minimum": 1, "maximum": 200, "default": 50},
    }},
)
async def prints(call: ToolCall) -> list[dict[str, Any]]:
    db: AsyncSession = call.context
    args = call.arguments
    drop_id, status = args.get("drop_id"), args.get("status")
    if status and drop_id is None:
        raise ToolRefused("Для решения по принту укажите drop_id: у разных дропов решения разные.")
    query = str(args.get("q") or "").strip().casefold()
    rows = []
    for item in await library.catalogue(db):
        name = item.tags.name.name if item.tags.name else item.file_name
        tags = [tag.name for tag in item.tags.tags]
        if query and query not in " ".join([name, item.file_name, *tags]).casefold():
            continue
        selected = item.links.drops.get(drop_id) if drop_id is not None else None
        if drop_id is not None and selected is None:
            continue
        if status and (selected is None or (selected.status or "not_proposed") != status):
            continue
        rows.append({
            "digest": item.digest, "name": name, "file_name": item.file_name, "tags": tags,
            "thumb": f"{settings().base_path}/assets/{item.digest}/thumb",
            "preview": f"{settings().base_path}/assets/{item.digest}/preview",
            "drops": [{"id": drop.id, "name": drop.name, "status": drop.status or "not_proposed",
                       "reason": drop.reason, "via_reference": drop.via} for drop in item.links.drops.values()],
            "references": [{"id": card.id, "name": card.name} for card in item.references],
        })
        if len(rows) >= int(args.get("limit") or 50):
            break
    return rows

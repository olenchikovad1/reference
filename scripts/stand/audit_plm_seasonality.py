"""Прочитать состав машинного контракта сезонности, без изменения PLM/Reference.

В контейнере api: python -m scripts.stand.audit_plm_seasonality.
Один GET, таймаут 10 секунд, без повторов. Ключи и тела документов не выводятся.
Наличие полей само по себе не подтверждает бизнес-смысл профиля группы.
"""
import asyncio
import json

import httpx

from reference_api.config import settings


async def audit() -> dict[str, object]:
    cfg = settings()
    if not cfg.plm_base_url or not cfg.plm_machine_key:
        raise RuntimeError("PLM application channel is not configured")
    async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
        response = await client.get(cfg.plm_base_url.rstrip('/') + '/api/machine/drops',
                                    headers={"Authorization": "Bearer " + cfg.plm_machine_key},
                                    params={"active_only": "false"})
    if response.status_code != 200:
        raise RuntimeError(f"PLM HTTP {response.status_code}")
    payload = response.json()
    rows = payload.get("items") if isinstance(payload, dict) else None
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise RuntimeError("PLM drops contract is not an items array")
    return {"http": 200, "drops": len(rows),
            "response_fields": sorted(payload),
            "drop_fields": sorted({field for row in rows for field in row}),
            "with_sales_window": sum(row.get("intake_week") is not None and row.get("exit_week") is not None for row in rows),
            "scope": "machine drops contract only; group profile semantics require source-owner confirmation"}


if __name__ == '__main__':
    try:
        print(json.dumps(asyncio.run(audit()), ensure_ascii=False))
    except (httpx.HTTPError, ValueError, RuntimeError) as error:
        # Исключение HTTP-клиента может содержать URL: печатаем только безопасный тип.
        print(json.dumps({"error": type(error).__name__}))
        raise SystemExit(1) from None

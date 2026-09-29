"""Слоганы стенда (US-0717): два-три десятка надписей дела, заведённых
заранее и предложенных в дропы и адресатам, — чтобы «Тексты» было что
показать, а наполнение витрины ставило их на референсы.

Тем же маршрутом, что человек на странице «Тексты»: завести надпись,
назначить дроп и адресата. Повторный запуск ничего не удваивает: та же
надпись по нормализованному — не вторая, та же связь — та же.

Где: контейнер api, стенд без платформы в процессе скрипта. Только стенд.

    docker compose -f infra/compose.yaml exec -T api python -m scripts.stand.seed_slogans

Надписи на референсы кладёт окно: `referenceStand.fill(n, зерно, 0.4)` —
последнее число — доля референсов с надписью (снимки рисует только окно).
"""

import asyncio
import re

import httpx

from reference_api.app import create_app

# (надпись, дроп по имени или None, адресат или None)
SLOGANS = [
    ("С НОВЫМ 2027", "Новый год 2027", "all"),
    ("ДЕД МОРОЗ ЗНАЕТ", "Новый год 2027", "all"),
    ("СНЕГ ИДЁТ", "Зима 2026/27", "all"),
    ("ЗИМА БЛИЗКО", "Зима 2026/27", "boys"),
    ("ТЁПЛАЯ ЗИМА", "Зима 2026/27", "girls"),
    ("ЛЕДЯНОЙ ПАТРУЛЬ", "Зима 2026/27", "boys"),
    ("СНЕЖНАЯ КОРОЛЕВА", "Зима 2026/27", "girls"),
    ("ЗАЩИТНИК", "23 февраля 2027", "boys"),
    ("БУДУЩИЙ КАПИТАН", "23 февраля 2027", "boys"),
    ("МАЛЕНЬКИЙ ГЕРОЙ", "23 февраля 2027", "boys"),
    ("ВСЕГДА НА ВАХТЕ", "23 февраля 2027", "boys"),
    ("ВЕСНА ПРИШЛА", "Весна 2027", "all"),
    ("ЦВЕТУ И РАСТУ", "Весна 2027", "girls"),
    ("ПРОСЫПАЙСЯ", "Весна 2027", "all"),
    ("ЛЕТО 2027", "Пляжная коллекция 2027", "all"),
    ("МОРЕ ЗОВЁТ", "Пляжная коллекция 2027", "all"),
    ("SUMMER VIBES", "Пляжная коллекция 2027", "girls"),
    ("КАПИТАН ПЛЯЖА", "Пляжная коллекция 2027", "boys"),
    ("ДРУЖБА", None, "all"),
    ("Я МОГУ", None, "all"),
    ("ВПЕРЁД", None, "boys"),
    ("МЕЧТАЙ", None, "girls"),
    ("ТАНКИСТ", None, "boys"),
    ("ПЛАМЯ", None, "boys"),
    ("КОТ В ДЕЛЕ", None, "all"),
    ("ХА-ХА", None, "all"),
]


def _key(text: str) -> str:
    """Как на сервере: пробелы сведены, заглавные — ключ надписи."""
    return re.sub(r"\s+", " ", text).strip().upper()


async def main() -> None:
    app = create_app(without_platform=True)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://stand") as c:
            drops = {d["name"]: d["id"] for d in (await c.get("/reference/api/drops")).json()}
            for text, drop, audience in SLOGANS:
                r = await c.post("/reference/api/library/texts", json={"text": text})
                r.raise_for_status()
                if drop:
                    if drop not in drops:
                        print(f"  {text}: дропа «{drop}» на стенде нет — без дропа")
                    else:
                        (await c.post("/reference/api/library/texts/links",
                                      json={"keys": [_key(text)], "drop_id": drops[drop]})).raise_for_status()
                if audience:
                    (await c.post("/reference/api/library/texts/links",
                                  json={"keys": [_key(text)], "audience": audience})).raise_for_status()
                print(f"  {text}: {drop or '—'}, {audience or '—'}")
    print(f"слоганов: {len(SLOGANS)}")


if __name__ == "__main__":
    asyncio.run(main())

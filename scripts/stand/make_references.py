"""Наполнить витрину стенда множеством разных референсов — проверить, как
витрина, окно и кэш держат 100+ карточек (владелец 28.09.2026).

Кофта одна — B-HDY-14, её цветомодели; мини-картинка витрины одна на всех
(кадр переда с принтом), — так меряется сама витрина, а не отрисовка
снимков. Разными делаются принт (из библиотеки стенда), цвет, размер, место
и ширина принта, имя. Сохраняется тем же маршрутом, что кнопка «Сохранить»:
узнавание «такой уже был», версия, работа — как у человека.

Где: контейнер api, стенд без платформы в процессе скрипта. Только стенд.

    docker compose -f infra/compose.yaml exec -T api python -m scripts.stand.make_references 120
"""

import asyncio
import io
import pathlib
import random
import sys
import time

import httpx
from PIL import Image

from sqlalchemy import select

from reference_api.app import create_app
from reference_api.db import session_factory
from reference_api.models.drops import ColourModel, GarmentModel

FRAME = pathlib.Path("/srv/reference/files/products/B-HDY-14/states/front.png")
SIZES = [98, 104, 110, 116, 122, 128, 134, 140, 146, 152, 158, 164]
SIDES = {"front": "перед", "back": "спина"}


def thumb(print_png: bytes) -> bytes:
    """Мини-картинка витрины: кадр переда и принт на груди — одна на всех."""
    frame = Image.open(FRAME).convert("RGBA")
    art = Image.open(io.BytesIO(print_png)).convert("RGBA")
    w = frame.width // 3
    art = art.resize((w, max(1, int(art.height * w / art.width))))
    frame.alpha_composite(art, ((frame.width - w) // 2, frame.height // 3))
    out = io.BytesIO()
    frame.save(out, "PNG")
    return out.getvalue()


async def main(n: int) -> None:
    rnd = random.Random(20260928)
    app = create_app(without_platform=True)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://stand", timeout=120) as c:
            api = "/reference/api"
            library = (await c.get(f"{api}/assets/library")).json()
            prints = [i for i in library if not i.get("defect")]
            async with session_factory() as db:
                rows = await db.execute(select(ColourModel.id, ColourModel.colour_code)
                                        .join(GarmentModel, GarmentModel.id == ColourModel.model_id)
                                        .where(GarmentModel.code == "B-HDY-14"))
                colours = [{"id": i, "colour_code": cc} for i, cc in rows]
            if not colours:
                sys.exit("у B-HDY-14 нет цветомоделей на стенде — референсы вышли бы без дропа")
            first = (await c.get(f"{api}/assets/{prints[0]['digest']}/preview")).content
            up = await c.post(f"{api}/assets", files=[("files", ("vitrina-thumb.png", io.BytesIO(thumb(first)), "image/png"))])
            view = up.json()[0]["digest"]
            started = time.perf_counter()
            for i in range(n):
                p = rnd.choice(prints)
                side = rnd.choice(list(SIDES))
                size = rnd.choice(SIZES)
                colour = rnd.choice(colours)
                colour_code = colour["colour_code"]
                element = {
                    "id": f"el-{i:05d}", "src": f"{api}/assets/{p['digest']}/preview", "kind": "image",
                    "name": p["file_name"], "aspect": 1.0, "hasAlpha": True,
                    "placement": {"dxCm": rnd.choice([-4, -2, 0, 2, 4]), "dyCm": rnd.choice([8, 10, 12, 14]),
                                  "side": side, "anchor": "neck", "widthCm": rnd.choice([10, 14, 18, 22]), "rotation": 0},
                }
                name = f"B-HDY-14 · {SIDES[side]} · {colour_code} · {size} · {(p.get('name') or {}).get('name') or p['file_name']}"
                body = {
                    "name": name, "sheet_digest": view, "image_digests": [p["digest"]], "texts": [],
                    "work": {"size": size, "version": 2, "stateCode": side, "colourCode": colour_code,
                             "composition": {"elements": [element], "selectedId": element["id"]}},
                    "views": {"front": view, "back": view},
                    "colour_model_id": colour["id"],
                }
                r = await c.post(f"{api}/references", json=body)
                if r.status_code != 200:
                    sys.exit(f"№{i}: {r.status_code} {r.text[:300]}")
                if (i + 1) % 20 == 0:
                    print(f"  сохранено {i + 1} из {n}, {time.perf_counter() - started:.0f} с")
            print(f"готово: {n} референсов за {time.perf_counter() - started:.0f} с; мини-картинка {view[:12]}…")


if __name__ == "__main__":
    asyncio.run(main(int(sys.argv[1]) if len(sys.argv) > 1 else 120))

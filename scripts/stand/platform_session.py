#!/usr/bin/env python3
"""Сессия локальной платформы для проверки «Референса» за её шлюзом.

Зачем: стенд за шлюзом (`compose.platform.yaml`) пускает только с входом в
платформу, а войти в браузере может лишь владелец — и проверка окна вставала
до его прихода (07.10.2026, план 114). Владелец разрешил брать сессию у
ЛОКАЛЬНОЙ платформы для тестов: это стенд на этой машине, не бой.

Что делает: внутри контейнера ядра (`platform-core-1`) открывает сессию той
же функцией, что вход (`services.sessions.open_session`), и печатает токен.
Его кладут в cookie `platform_session` на http://localhost:8100 — в браузере
панели это `document.cookie = "platform_session=<токен>; path=/"`. Сессия
обычная: живёт свой срок, видна в списке сессий человека, закрывается там же.

Чья сессия: по умолчанию — субъекта с наибольшим числом грантов (на стенде
это владелец, единственный со всеми правами); иначе — по почте аргументом.

Где: хост, нужен только docker. Запуск из корня репозитория:

    py scripts/stand/platform_session.py [почта]

Только для локального стенда: на сервер платформы скрипт не ходит и ходить
не должен.
"""

import subprocess
import sys

CORE = "platform-core-1"

PROGRAM = r'''
import asyncio, os, sys
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker
from platform_core.db import make_engine
from platform_core.services.sessions import open_session

async def main(email):
    engine = make_engine(os.environ["PLATFORM_DATABASE_URL"])
    async with async_sessionmaker(engine)() as db:
        if email:
            row = (await db.execute(text("select id from subjects where email = :e"), {"e": email})).first()
        else:
            row = (await db.execute(text(
                "select s.id from subjects s left join grants g on g.subject_id = s.id "
                "group by s.id order by count(g.subject_id) desc limit 1"))).first()
        if row is None:
            sys.exit("субъекта нет: " + (email or "в платформе ни одного"))
        opened = await open_session(db, subject_id=row[0], agent="стенд reference: проверка")
        print(opened.token)
    await engine.dispose()

asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else ""))
'''


def main() -> int:
    email = sys.argv[1] if len(sys.argv) > 1 else ""
    run = subprocess.run(
        ["docker", "exec", "-i", CORE, "/srv/.venv/bin/python", "-", email],
        input=PROGRAM, capture_output=True, text=True, encoding="utf-8",
    )
    if run.returncode != 0:
        print(f"сессия не открылась ({CORE} поднят?): {run.stderr.strip()[-400:]}", file=sys.stderr)
        return 1
    print(run.stdout.strip())
    return 0


if __name__ == "__main__":
    sys.exit(main())

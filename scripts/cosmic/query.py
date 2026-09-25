#!/usr/bin/env python3
"""Запрос к Cosmic PLM на чтение: ролью plmportal_ro через ssh-туннель.

Cosmic живёт во внутренней сети офиса. Из дома до него доходят через сервер
sandbox (25.09.2026): оттуда порт базы виден. Туннель открывается на
127.0.0.1 — не на все адреса машины, иначе база Cosmic станет доступна всей
локальной сети.

Откуда что берётся — ничего из этого в git не лежит:
- строка подключения к базе (роль plmportal_ro и её пароль) — из
  `infra/.env` соседнего проекта plmportal, ключ `PLM_COSMIC_URL`;
- через кого идёт туннель и где база внутри — из `infra/.env` этого проекта,
  ключи `COSMIC_SSH` и `COSMIC_DB`. Значения — в `~/.claude/infra_ssh_hosts.md`
  (sandbox и plm).

Пароль в вывод не попадает. Запросы только на чтение: роль другого не умеет.

Где: хост; psql — из образа postgres в докере, ставить его не нужно.

    py scripts/cosmic/query.py "select 1"
"""

import os
import pathlib
import re
import socket
import subprocess
import sys
from urllib.parse import unquote, urlparse

ROOT = pathlib.Path(__file__).resolve().parents[2]
PLMPORTAL_ENV = ROOT.parent / "plmportal/infra/.env"
OWN_ENV = ROOT / "infra/.env"
LOCAL_PORT = 15440
PSQL_IMAGE = "postgres:17.6-alpine"


def env_value(path: pathlib.Path, key: str) -> str | None:
    if not path.is_file():
        return None
    for line in path.read_text(encoding="utf-8").splitlines():
        m = re.match(rf"\s*{key}\s*=\s*(.*?)\s*$", line)
        if m:
            return m.group(1).strip('"').strip("'") or None
    return None


def need(path: pathlib.Path, key: str, hint: str) -> str:
    value = os.environ.get(key) or env_value(path, key)
    if not value:
        sys.exit(f"нет {key}: {hint} ({path})")
    return value


def tunnel_up() -> bool:
    try:
        with socket.create_connection(("127.0.0.1", LOCAL_PORT), timeout=2):
            return True
    except OSError:
        return False


def ensure_tunnel(ssh_target: str, db: str) -> None:
    if tunnel_up():
        return
    r = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "-o", "ExitOnForwardFailure=yes",
         "-f", "-N", "-L", f"127.0.0.1:{LOCAL_PORT}:{db}", *ssh_target.split()],
        capture_output=True, text=True,
    )
    if r.returncode or not tunnel_up():
        sys.exit(f"туннель к Cosmic не поднялся через {ssh_target}: {r.stderr.strip() or 'порт не открылся'}")


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    url = urlparse(need(PLMPORTAL_ENV, "PLM_COSMIC_URL", "строка подключения роли plmportal_ro")
                   .replace("postgresql+asyncpg://", "postgresql://"))
    ensure_tunnel(need(OWN_ENV, "COSMIC_SSH", "через кого туннель, напр. «-p 22 логин@sandbox»"),
                  need(OWN_ENV, "COSMIC_DB", "адрес базы внутри сети, хост:порт"))
    out = subprocess.run(
        ["docker", "run", "--rm", "-e", "PGPASSWORD", PSQL_IMAGE,
         "psql", "-h", "host.docker.internal", "-p", str(LOCAL_PORT),
         "-U", unquote(url.username or ""), "-d", url.path.lstrip("/"),
         "-v", "ON_ERROR_STOP=1", "-P", "pager=off", "-c", sys.argv[1]],
        env=dict(os.environ, PGPASSWORD=unquote(url.password or "")),
        capture_output=True, text=True, encoding="utf-8",
    )
    sys.stdout.write(out.stdout)
    if out.returncode:
        sys.stdout.write(out.stderr)
        sys.exit(out.returncode)


if __name__ == "__main__":
    main()

"""Локальный read-only мост для проверки Reference с живым PLM.

Стандартная библиотека; запуск на машине владельца. Личный ключ читается
из прежнего access-file при запросе, в контейнер/окружение не передаётся.
Слушает только loopback, поддерживает только GET каталога/паспортов/preview.
Режим --ssh-host читает существующий служебный ключ Reference в память
оператора и обращается к штатному machine API PLM. Ключ не пишется в файл,
не передаётся локальному API и не выводится в журнал.
"""
import argparse
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import shlex
import subprocess
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError, URLError


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


@dataclass(frozen=True)
class Source:
    base_url: str
    access_file: Path | None = None
    machine_key: str | None = field(default=None, repr=False)

    def headers(self) -> dict[str, str]:
        if self.access_file:
            return json.loads(self.access_file.read_text(encoding='utf-8-sig'))['headers']
        return {'Authorization': 'Bearer ' + (self.machine_key or '')}


def application_source(host: str, user: str, port: int, container: str) -> Source:
    """Служебный ключ остаётся в памяти оператора; в локальный API не передаётся."""
    if any(not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*', value) for value in (host, user, container)) or not 1 <= port <= 65535:
        raise ValueError('Invalid SSH source configuration')
    code = 'from reference_api.config import settings; print(settings().plm_machine_key or "")'
    command = ' '.join(shlex.quote(value) for value in ('docker', 'exec', container, 'python', '-c', code))
    result = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-p', str(port),
                             user + '@' + host, command], capture_output=True, text=True, timeout=15)
    key = result.stdout.strip()
    if result.returncode or not key or key.startswith('pfb_') or len(key) > 4096:
        raise ValueError('Application credential unavailable; source not started')
    return Source('https://platform.toribrands.ru/plm/api/machine/', machine_key=key)


def serve(source: Source, port: int) -> None:
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            path = urlsplit(self.path)
            prefix = '/api/machine/'
            resource = path.path.removeprefix(prefix)
            allowed = re.fullmatch(r'(?:drops|colorways|colors|releases|(?:colorways|releases)/[A-Za-z0-9-]{1,64}|images/[A-Za-z0-9-]{1,64}/(?:thumb|preview))', resource)
            if not path.path.startswith(prefix) or not allowed:
                self.send_error(404); return
            try:
                url = source.base_url + resource
                if path.query:
                    url += '?' + path.query
                with build_opener(NoRedirect()).open(Request(url, headers=source.headers()), timeout=15) as r:
                    data, status = r.read(16_000_001), r.status
                    media_type = r.headers.get('Content-Type', 'application/json')
                if len(data) > 16_000_000:
                    raise ValueError('Source response exceeds limit')
            except HTTPError as error:
                data, status, media_type = b'{"detail":"PLM source refused"}', error.code, 'application/json'
            except (OSError, ValueError, KeyError, URLError):
                data, status, media_type = b'{"detail":"PLM source unavailable"}', 503, 'application/json'
            self.send_response(status)
            self.send_header('Content-Type', media_type)
            self.send_header('Content-Length', str(len(data)))
            self.end_headers(); self.wfile.write(data)

    print(f'PLM read-only proxy: 127.0.0.1:{port}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    source_args = p.add_mutually_exclusive_group(required=True)
    source_args.add_argument('--access-file', type=Path)
    source_args.add_argument('--ssh-host', help='Read the existing application credential over SSH; never copied to a file')
    p.add_argument('--ssh-user')
    p.add_argument('--ssh-port', type=int, default=22)
    p.add_argument('--ssh-container', default='reference-api-1')
    p.add_argument('--port', default=5186, type=int)
    args = p.parse_args()
    if args.ssh_host and not args.ssh_user:
        p.error('--ssh-user is required with --ssh-host')
    if not 1 <= args.port <= 65535:
        p.error('Invalid loopback port')
    try:
        source = application_source(args.ssh_host, args.ssh_user, args.ssh_port, args.ssh_container) if args.ssh_host else Source(
            'https://platform.toribrands.ru/reference/api/plm/', access_file=args.access_file)
    except (OSError, ValueError, subprocess.SubprocessError):
        raise SystemExit('Read-only source unavailable; no credentials logged') from None
    serve(source, args.port)

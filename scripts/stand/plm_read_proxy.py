"""Локальный read-only мост для проверки Reference с живым PLM.

Стандартная библиотека; запуск на машине владельца. Личный ключ читается
из прежнего access-file при запросе, в контейнер/окружение не передаётся.
Слушает только loopback, поддерживает только GET машинного каталога.
"""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError, URLError


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def serve(access_file: Path, port: int) -> None:
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            path = urlsplit(self.path)
            prefix = '/api/machine/'
            resource = path.path.removeprefix(prefix)
            if not path.path.startswith(prefix) or resource not in {'drops', 'colorways', 'colors'}:
                self.send_error(404); return
            try:
                access = json.loads(access_file.read_text(encoding='utf-8-sig'))
                url = 'https://platform.toribrands.ru/reference/api/plm/' + resource
                if path.query:
                    url += '?' + path.query
                with build_opener(NoRedirect()).open(Request(url, headers=access['headers']), timeout=10) as r:
                    data, status = r.read(), r.status
            except HTTPError as error:
                data, status = b'{"detail":"PLM source refused"}', error.code
            except (OSError, ValueError, KeyError, URLError):
                data, status = b'{"detail":"PLM source unavailable"}', 503
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers(); self.wfile.write(data)

    print(f'PLM read-only proxy: 127.0.0.1:{port}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--access-file', required=True, type=Path)
    p.add_argument('--port', default=5186, type=int)
    args = p.parse_args()
    serve(args.access_file, args.port)

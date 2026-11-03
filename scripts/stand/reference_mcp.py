"""Локальное stdio-подключение к HTTP MCP Reference без копии личного ключа.

Клиент запускает этот файл с --access-file; файл авторизации перечитывается
на каждом вызове. Только чтение: изменяющие инструменты не объявляются и
не вызываются через этот мост. Зависимостей вне стандартной библиотеки нет.
"""
import argparse
import json
from pathlib import Path
import sys
from typing import Any
import urllib.error
import urllib.parse
import urllib.request

READ_TOOLS = frozenset({"references", "reference", "drops", "drop_assortment", "drop_board", "prints"})


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Личный Authorization не должен уйти по перенаправлению на другой вход.
        return None


def answer(message: dict[str, Any], access_file: Path, url: str) -> dict[str, Any] | None:
    def failure(code: int, text: str) -> dict[str, Any] | None:
        return {"jsonrpc": "2.0", "id": message["id"], "error": {"code": code, "message": text}} if "id" in message else None

    method = message.get("method")
    if method not in {"initialize", "notifications/initialized", "ping", "tools/list", "tools/call"}:
        return failure(-32601, "Метод недоступен")
    params = message.get("params") or {}
    if method == "tools/call" and (not isinstance(params, dict) or params.get("name") not in READ_TOOLS):
        return failure(-32601, "Инструмент недоступен")
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"}):
        return failure(-32600, "MCP требует HTTPS либо локальный loopback")
    try:
        access = json.loads(access_file.read_text(encoding="utf-8-sig"))
        headers = {**access["headers"], "Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
        request = urllib.request.Request(url, data=json.dumps(message).encode("utf-8"), headers=headers)
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=15) as response:
            if response.status == 202:
                return None
            result = json.load(response)
    except urllib.error.HTTPError as refused:
        return failure(-32000, f"Reference HTTP {refused.code}; проверьте доступ и локальный ключ")
    except (OSError, ValueError, KeyError, urllib.error.URLError):
        # Ошибка HTTP-клиента может включать заголовки; наружу они не печатаются.
        return failure(-32000, "Reference недоступен или локальный файл доступа не прочитан")
    if not isinstance(result, dict):
        return failure(-32603, "Некорректный ответ Reference")
    if method == "tools/list" and isinstance(result.get("result"), dict):
        result["result"]["tools"] = [tool for tool in result["result"].get("tools", []) if tool.get("name") in READ_TOOLS]
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--access-file", required=True, type=Path)
    parser.add_argument("--url", default="https://platform.toribrands.ru/reference/api/mcp")
    args = parser.parse_args()
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    for line in sys.stdin:
        try:
            message = json.loads(line)
            if not isinstance(message, dict):
                raise ValueError("packet")
            result = answer(message, args.access_file, args.url)
        except (ValueError, TypeError):
            result = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Некорректный JSON-RPC"}}
        if result is not None:
            print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()

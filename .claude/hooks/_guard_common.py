"""Общее для хуков-предохранителей: чтение запроса, настройка, ответ.

Вынесено в один модуль намеренно. Разбор командной строки, определённый в двух
хуках независимо, совпадает ровно до первой правки одного из них, после чего
расходится молча — а расхождение здесь означает, что один хук ловит то, что
второй пропускает.
"""

import json
import os
import shlex
import threading
import subprocess
import sys
from pathlib import Path

# Разделители, за которыми начинается следующая команда. Нужны потому, что
# `git add -A && git push origin main` приходит хуку одной строкой.
SEPARATORS = {"&&", "||", ";", "|", "&", "\n"}


def read_request(timeout: float = 5.0) -> dict:
    """Запрос инструмента со стандартного ввода. Пустой или неразбираемый — пустой словарь.

    Неразбираемый вход — не повод падать: хук, роняющий команду, мешает работать сильнее,
    чем пропущенное нарушение.

    Ждать ввод бесконечно нельзя. Хук запускают и руками — проверить правило по дереву; с
    неизвестным флагом такой запуск доходил до чтения ввода, а ввода у него нет и не
    будет. Процесс тогда висит молча: один такой провисел сорок четыре минуты, ничего не
    делая, и был заметен только как строка в списке задач. Поэтому:

    - ввод не с терминала (обычный запуск хуком) читается целиком, но не дольше `timeout`;
    - ввод с терминала (запуск руками) не читается вовсе — там его никто не подаёт.
    """
    if sys.stdin is None or sys.stdin.closed:
        return {}
    try:
        if sys.stdin.isatty():
            return {}
    except (ValueError, OSError):
        return {}

    raw = ""
    result: list[str] = []

    def _read() -> None:
        try:
            result.append(sys.stdin.read())
        except (ValueError, OSError):
            result.append("")

    reader = threading.Thread(target=_read, daemon=True)
    reader.start()
    reader.join(timeout)
    if result:
        raw = result[0]
    try:
        return json.loads(raw or "{}")
    except ValueError:
        return {}


def bash_command(request: dict) -> str:
    """Команда, если это вызов оболочки. Иначе — пусто."""
    if request.get("tool_name") != "Bash":
        return ""
    return (request.get("tool_input") or {}).get("command") or ""


def project_dir(request: dict) -> Path:
    return Path(request.get("cwd") or os.environ.get("CLAUDE_PROJECT_DIR")
                or Path.cwd())


def setting(request: dict, key: str, default):
    """Значение из `.claude/rails.json` проекта.

    Условия срабатывания не зашиваются в хук: общая ветка где-то называется
    `master`, где-то `prod`, а заготовка одна на все проекты. Настройка
    **заменяет** умолчание целиком, а не дополняет: иначе от списка нельзя
    отказаться.
    """
    start = project_dir(request)
    candidates = [start, *start.parents]
    env_root = os.environ.get("CLAUDE_PROJECT_DIR")
    if env_root:
        candidates.insert(0, Path(env_root))
    for base in candidates[:12]:
        path = base / ".claude" / "rails.json"
        if path.is_file():
            try:
                value = json.loads(path.read_text(encoding="utf-8")).get(key)
            except (ValueError, OSError):
                return default
            if value is not None:
                return value
    return default


def commands(command: str) -> list[list[str]]:
    """Разбить строку на отдельные команды и разобрать каждую на слова.

    Разбор, а не поиск подстроки: `echo 'git push origin main'` не является
    пушем, и останавливать его нельзя. Хук, срабатывающий на упоминание,
    выключают целиком — вместе с той частью, что стоит на опасном.
    """
    try:
        lexer = shlex.shlex(command, posix=True, punctuation_chars=True)
        lexer.whitespace_split = True
        tokens = list(lexer)
    except ValueError:
        return []  # незакрытая кавычка: разобрать нельзя, значит молчим

    out, current = [], []
    for token in tokens:
        if token in SEPARATORS:
            if current:
                out.append(current)
            current = []
        else:
            current.append(token)
    if current:
        out.append(current)
    return out


def git_subcommand(words: list[str], name: str) -> list[str] | None:
    """Слова после `git <name>`, если команда именно такая.

    Учитывается `VAR=x git ...` и `git -C <путь> ...`: и то и другое —
    обычный способ вызова, и пропускать его нельзя.
    """
    i = 0
    while i < len(words) and "=" in words[i] and not words[i].startswith("-"):
        i += 1  # присваивания перед командой
    if i >= len(words) or Path(words[i]).name not in ("git", "git.exe"):
        return None
    i += 1
    while i < len(words) and words[i].startswith("-"):
        # глобальные ключи git: часть из них со значением
        if words[i] in ("-C", "-c", "--git-dir", "--work-tree", "--namespace"):
            i += 2
        else:
            i += 1
    if i >= len(words) or words[i] != name:
        return None
    return words[i + 1:]


def current_branch(request: dict) -> str | None:
    """Ветка, которую отправит `git push` без ссылки.

    `branch --show-current`, а не `rev-parse --abbrev-ref HEAD`: второй не
    отвечает на ветке без коммитов, а свежесозданная ветка задачи — обычное
    состояние в момент, когда правило как раз и должно сработать.
    """
    try:
        result = subprocess.run(
            ["git", "branch", "--show-current"],
            cwd=str(project_dir(request)), capture_output=True, text=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    branch = result.stdout.strip()
    return branch or None


def _respond(decision: str, reason: str) -> None:
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": decision,
            "permissionDecisionReason": reason,
        }
    }, ensure_ascii=False))


def ask(reason: str) -> None:
    """Спросить человека. Разрешение даётся на один вызов и не переносится
    на следующий — это и требуется правилом про общие ветки."""
    _respond("ask", reason)


def deny(reason: str) -> None:
    """Остановить. Только там, где последствие необратимо или дорого."""
    _respond("deny", reason)


def silent() -> None:
    """Промолчать: команда идёт обычным путём."""
    return None

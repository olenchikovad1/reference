"""Коммит в ветке задачи уезжает на удалённый сам.

# event: PostToolUse
# skill: process-git

Правило говорит: работа, лежащая только на одной машине, не сделана. Пока это
держалось памятью, оно не держалось — и цена известна поимённо: вечер работы
остался на домашней машине, утром человек посмотрел, решил, что всё отправлено,
и продолжил на рабочей. Обнаружилось это через сутки, разбором «почему в
репозитории ничего нет».

Почему хук, а не напоминание в тексте правила: напоминание читает тот, кто и
так помнит. Пуш — действие механическое, у него нет ни одного повода ждать
отдельной просьбы, и отсутствие этой просьбы не должно означать потерю работы.

Почему только ветка задачи. В общие ветки (`main`, `master`, `develop` и что
ещё названо в `rails.json`) пуш спрашивает человека — это другое правило и
другой хук (`guard_shared_branch_push.py`). Здесь они пропускаются молча:
автоматический пуш в общую ветку был бы ровно тем, что то правило запрещает.

Хук **ничего не блокирует**. Он выполняется после успешного коммита, и его
отказ — это строка в ответе, а не остановка работы: сеть недоступна, удалённого
нет, права не те — всё это поводы сказать, а не мешать.
"""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import _guard_common as g  # noqa: E402

# Ветки, в которые не пушим сами. Совпадает с умолчанием стража общих веток:
# два списка с одним смыслом однажды разошлись бы, и разошлись бы молча.
DEFAULT_SHARED = ["main", "master", "develop"]

# Пуш идёт по сети, и без предела он превращает отказ в зависание (З-26).
PUSH_TIMEOUT = 120


def committed(request: dict) -> bool:
    """Была ли в команде фиксация, и удалась ли она.

    Разбор команды, а не поиск подстроки: `echo "git commit"` фиксацией не
    является. Успех берётся из ответа инструмента — пушить после отказавшего
    коммита значит отправлять прошлое состояние и делать вид, что всё хорошо.
    """
    command = g.bash_command(request)
    if not command:
        return False
    if not any(g.git_subcommand(words, "commit") is not None
               for words in g.commands(command)):
        return False

    answer = request.get("tool_response") or {}
    if isinstance(answer, dict):
        # У разных версий оболочки поле называется по-разному; отсутствие
        # признака считаем успехом — иначе хук молчит там, где должен работать.
        for key in ("exit_code", "exitCode", "returncode"):
            if key in answer:
                return int(answer[key] or 0) == 0
        if answer.get("is_error") or answer.get("isError"):
            return False
    return True


def _windows_path(target: str) -> str:
    """`/c/Projects/...` — путь оболочки MSYS, а не путь Windows.

    Git Bash на этой машине — обычный способ звать команды, и путь в его виде
    Python не открывает: `Path("/c/...").is_dir()` отвечает «нет», и хук
    оставался в каталоге сессии, посмотрев не туда.
    """
    match = re.match(r"^/([A-Za-z])/(.*)$", target)
    return f"{match.group(1).upper()}:/{match.group(2)}" if match else target


def repositories(request: dict) -> list[Path]:
    """Все репозитории, которых команда коснулась.

    Каталог сессии сам по себе не годится: команда часто начинается с перехода
    в соседний репозиторий (`cd ../portal && git commit ...`), и хук,
    спросивший каталог сессии, отчитается об успехе, посмотрев не туда.

    Одного «последнего перехода» тоже мало: одна команда умеет закоммитить в
    двух репозиториях подряд, и тогда второй пуш оставляет первый коммит
    лежать на месте — поймано ровно так.

    Поэтому собираются все переходы (`cd <путь>`, `git -C <путь>`) вместе с
    каталогом сессии, и каждый сводится к корню своего репозитория.
    """
    start = g.project_dir(request)
    seen: list[Path] = []
    walking = start
    for words in g.commands(g.bash_command(request)):
        for index, word in enumerate(words):
            target = None
            if word in ("cd", "-C") and index + 1 < len(words):
                target = words[index + 1]
            if not target or target.startswith("-"):
                continue
            path = Path(_windows_path(target))
            if not path.is_absolute():
                path = walking / target
            if path.is_dir():
                walking = path.resolve()
                seen.append(walking)

    roots: list[Path] = []
    for candidate in [start, *seen]:
        root = toplevel(candidate)
        if root is not None and root not in roots:
            roots.append(root)
    return roots


def toplevel(cwd: Path) -> Path | None:
    """Корень репозитория. `None` — это не репозиторий вовсе."""
    try:
        result = run("rev-parse", "--show-toplevel", cwd=cwd, timeout=5)
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    return Path(result.stdout.strip()).resolve() if result.stdout.strip() else None


def run(*args: str, cwd: Path, timeout: int = 15):
    return subprocess.run(["git", *args], cwd=str(cwd), capture_output=True,
                          text=True, timeout=timeout)


def current_branch(cwd: Path) -> str | None:
    """Ветка того репозитория, где был коммит.

    `branch --show-current`, а не `rev-parse --abbrev-ref HEAD`: второй молчит
    на ветке без коммитов, а отсоединённая голова ветки не имеет вовсе — и в
    обоих случаях пушить нечего.
    """
    try:
        result = run("branch", "--show-current", cwd=cwd, timeout=5)
    except (OSError, subprocess.SubprocessError):
        return None
    return (result.stdout.strip() or None) if result.returncode == 0 else None


def has_origin(cwd: Path) -> bool:
    try:
        return run("remote", "get-url", "origin", cwd=cwd).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def nothing_to_push(cwd: Path, branch: str) -> bool:
    """Ветка уже совпадает с удалённой — пушить нечего."""
    try:
        result = run("rev-list", "--count", f"origin/{branch}..{branch}", cwd=cwd)
    except (OSError, subprocess.SubprocessError):
        return False
    if result.returncode != 0:
        # Удалённой ветки ещё нет — значит есть что отправить, и вместе с ней
        # заводится связь (`-u`).
        return False
    return result.stdout.strip() == "0"


def say(lines: list[str]) -> None:
    """Сказать модели и человеку, чем кончилось. Блокировки здесь не бывает.

    Одним сообщением, а не строкой на репозиторий: несколько объектов JSON
    подряд — это не ответ хука, а мусор, который разбирают по-разному.
    """
    if not lines:
        return
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": chr(10).join(lines),
        }
    }, ensure_ascii=False))


def main() -> None:
    request = g.read_request()
    if not committed(request):
        return

    shared = set(g.setting(request, "shared_branches", DEFAULT_SHARED)) | set(DEFAULT_SHARED)
    said = [line for cwd in repositories(request)
            if (line := publish(cwd, shared)) is not None]
    say(said)


def publish(cwd: Path, shared: set[str]) -> str | None:
    """Отправить ветку задачи одного репозитория. Возвращает, что сказать."""
    branch = current_branch(cwd)
    if not branch or branch in shared:
        return None

    name = cwd.name
    if not has_origin(cwd):
        return (f"{name}: ветка «{branch}» никуда не отправлена — у репозитория "
                f"нет удалённого «origin». Работа есть только на этой машине, "
                f"скажи об этом человеку.")

    if os.environ.get("CLAUDE_NO_AUTO_PUSH"):
        return (f"{name}: пуш ветки «{branch}» отключён переменной "
                f"CLAUDE_NO_AUTO_PUSH — коммит остался только здесь.")

    try:
        result = run("push", "-u", "origin", "HEAD", cwd=cwd, timeout=PUSH_TIMEOUT)
    except subprocess.TimeoutExpired:
        return (f"{name}: пуш ветки «{branch}» не уложился в {PUSH_TIMEOUT} с и "
                f"был прерван. Коммит остался только на этой машине.")
    except (OSError, subprocess.SubprocessError) as failure:
        return (f"{name}: пуш ветки «{branch}» не выполнился: {failure}. Коммит "
                f"остался только на этой машине.")

    if result.returncode != 0:
        reason = (result.stderr or result.stdout or "").strip().splitlines()
        return (f"{name}: пуш ветки «{branch}» отказал — "
                f"{reason[-1] if reason else 'без причины'}. Коммит остался "
                f"только на этой машине, скажи человеку, а не молчи.")

    if not nothing_to_push(cwd, branch):
        # Команда отчиталась об успехе, а ветки не сошлись: так бывает при пуше
        # не туда (чужой `push.default`, переписанная ссылка). Молчать здесь
        # опаснее всего — выглядит как «всё отправлено».
        return (f"{name}: пуш ветки «{branch}» отчитался об успехе, но удалённая "
                f"ветка с местной не сошлась. Проверь, куда она уехала.")
    return f"{name}: ветка «{branch}» отправлена в origin."


if __name__ == "__main__":
    main()

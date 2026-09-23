"""«Готово» не произносится без прогона.

# event: Stop
# skill: quality-verification

Правило говорит: не заявлять, что работает, исправлено или готово, без
команды, которая это доказывает. Проверять его некому — уверенное рассуждение
выглядит ровно так же, как факт, и человек узнаёт разницу, когда открывает
приложение сам.

Хук смотрит последний ход: было ли в нём заявление о готовности и был ли
прогон. Напоминание не блокирует ответ (код возврата 0): бывает работа, где
прогонять нечего — документ, план, само правило, — и тогда достаточно сказать,
что проверка была ручной.

Главное требование к этому хуку — **редкость**. Напоминание, приходящее на
каждый ответ, перестают читать за день, и тогда правило не действует вовсе.
Поэтому заявление распознаётся узко: только утверждение о законченности в
настоящем или прошедшем времени, без «осталось», «будет» и пересказа чужих
слов.
"""

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import _guard_common as g  # noqa: E402

# Команды, прогон которых считается доказательством. Список заменяется
# настройкой `proof_commands`: в разных проектах доказывают разным.
DEFAULT_PROOF = [
    "pytest", "unittest", "npm test", "npm run test", "yarn test",
    "go test", "cargo test", "make test", "make check", "tox",
    "vitest", "jest", "playwright", "ruff", "mypy", "eslint", "tsc",
]

# Инструменты, которые ничего не запускают: прочитать код — не то же самое,
# что убедиться, что он работает.
PASSIVE_TOOLS = {"Read", "Glob", "Grep", "TodoWrite", "WebFetch", "WebSearch"}

CLAIM = re.compile(
    r"(?:^|[.!?»)\]\n]\s*|\A)\s*"
    r"(готово\b"
    r"|всё\s+работает\b|все\s+работает\b"
    r"|теперь\s+работает\b"
    r"|(?:баг|ошибка|проблема)\s+(?:починен|починена|исправлен|исправлена)\b"
    r"|исправила?\s*[—-]|починила?\s*[—-]"
    r"|проверка\s+проходит\b"
    r")",
    re.IGNORECASE)

# Слова, при которых заявления нет: работа ещё идёт либо речь о чужих словах.
NOT_A_CLAIM = re.compile(
    r"(осталось|будет\s+готово|почти|пока\s+не|ещё\s+не|еще\s+не"
    r"|ты\s+пис|вы\s+писа|по\s+твоим\s+словам|как\s+ты\s+сказал"
    r"|проверил[аи]?\s+вручную|проверк[аи]\s+был[аи]\s+ручн"
    r"|вручную\s+в\s+интерфейсе|автопрогона\s+здесь\s+не)",
    re.IGNORECASE)


def last_turn(transcript: Path) -> list[dict]:
    """Записи последнего хода — от последней реплики человека до конца.

    Прогон в позапрошлом ходу ничего не доказывает про изменения этого.
    """
    try:
        lines = transcript.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    entries = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            entries.append(json.loads(line))
        except ValueError:
            continue
    start = 0
    for i, e in enumerate(entries):
        if e.get("type") == "user":
            start = i + 1
    return entries[start:]


def _content(entry: dict) -> list[dict]:
    content = (entry.get("message") or {}).get("content")
    return content if isinstance(content, list) else []


def said(entries: list[dict]) -> str:
    out = []
    for e in entries:
        if e.get("type") != "assistant":
            continue
        for part in _content(e):
            if part.get("type") == "text":
                out.append(part.get("text") or "")
    return "\n".join(out)


def ran_proof(entries: list[dict], proof: list[str]) -> bool:
    for e in entries:
        for part in _content(e):
            if part.get("type") != "tool_use":
                continue
            name = part.get("name") or ""
            if name in PASSIVE_TOOLS:
                continue
            if name != "Bash":
                continue
            command = (part.get("input") or {}).get("command") or ""
            low = command.lower()
            if any(marker.lower() in low for marker in proof):
                return True
    return False


def main() -> None:
    request = g.read_request()
    path = request.get("transcript_path")
    if not path:
        return None

    entries = last_turn(Path(path))
    text = said(entries)
    if not text or not CLAIM.search(text) or NOT_A_CLAIM.search(text):
        return None

    proof = g.setting(request, "proof_commands", DEFAULT_PROOF)
    if ran_proof(entries, proof):
        return None

    print(
        "Заявлена готовность, но в этом ходу не было ни одного прогона.\n"
        "Правило `quality-verification`: не говорить, что работает, исправлено "
        "или готово, без команды, которая это доказывает.\n"
        "Если прогонять нечего — документ, план, конфигурация, — скажи, что "
        "проверка была ручной или что автопрогона здесь не бывает. Молчание "
        "про способ проверки читается как утверждение, что автопрогон был.",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()

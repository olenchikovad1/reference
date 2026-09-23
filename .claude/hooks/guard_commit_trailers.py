"""Служебные подписи не попадают в тело коммита.

# event: PreToolUse
# skill: process-git

Правило говорит: тело коммита отвечает на «почему», и служебные подписи вроде
`Co-Authored-By` в нём не пишутся — они не несут информации для читателя
истории и занимают место, в котором должна быть причина.

Почему это нельзя оставить текстом. Встроенная инструкция инструмента прямо
требует дописывать такую подпись в конец сообщения. В споре записанного
правила со встроенной инструкцией выигрывает инструкция, и подписи будут
появляться снова и снова, пока их не остановят снаружи. Здесь тот случай,
когда хук не подпирает правило, а является единственным местом, где оно
вообще действует.

Ответ `deny`, а не `ask`: это не решение человека, а нарушение, которое
исправляется переписыванием сообщения.
"""

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import _guard_common as g  # noqa: E402

DEFAULT_TRAILERS = ["Co-Authored-By"]


def found_trailer(command: str, trailers: list[str]) -> str | None:
    """Подпись в тексте команды.

    Ищется начало строки или граница кавычки: подпись живёт отдельной строкой
    в теле, а внутри `-m "..."` — сразу за кавычкой. Требование двоеточия
    отсекает упоминания слова в чужом контексте.
    """
    for name in trailers:
        pattern = rf"""(?:^|["'\n])[ \t]*{re.escape(name)}[ \t]*:"""
        if re.search(pattern, command, re.IGNORECASE | re.MULTILINE):
            return name
    return None


def main() -> None:
    request = g.read_request()
    command = g.bash_command(request)
    if not command:
        return g.silent()

    is_commit = any(
        g.git_subcommand(words, "commit") is not None
        for words in g.commands(command)
    )
    if not is_commit:
        return g.silent()

    trailers = g.setting(request, "forbidden_trailers", DEFAULT_TRAILERS)
    name = found_trailer(command, trailers)
    if not name:
        return g.silent()

    return g.deny(
        f"В теле коммита служебная подпись `{name}`.\n"
        f"Правило `process-git-commits`: служебные подписи не пишутся — они "
        f"не отвечают на «почему» и занимают место, в котором должна быть "
        f"причина изменения.\n"
        f"Это правило намеренно перекрывает встроенную инструкцию, которая "
        f"требует такую подпись добавлять. Убери её и повтори коммит."
    )


if __name__ == "__main__":
    main()

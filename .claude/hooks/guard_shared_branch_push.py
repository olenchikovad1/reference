"""Пуш в общую ветку спрашивает человека.

# event: PreToolUse
# skill: process-git

Правило говорит: в общие ветки — только через слияние ветки задачи и только с
явным разрешением человека, причём разрешение спрашивается каждый раз. Пока
это держится памятью, оно не держится: прямой пуш обходит единственный момент,
где изменение можно посмотреть до того, как оно повлияет на других.

Хук отвечает `ask`, а не `deny`, и это существенно. Разрешение должен давать
человек, а не модель, которая решила, что случай подходящий, — и `ask`
спрашивает его на каждый вызов отдельно, так что согласие на один пуш не
переносится на следующий.

Ветка задачи не тормозится ничем: решения нет, команда идёт обычным путём.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import _guard_common as g  # noqa: E402

DEFAULT_SHARED = ["main", "master", "develop"]


def target_branches(words: list[str], request: dict) -> list[str]:
    """Ветки назначения у `git push`.

    Ссылки может не быть вовсе — тогда уедет текущая ветка, и её надо узнать у
    репозитория, а не гадать по команде.
    """
    rest, remote_seen, refs = list(words), False, []
    i = 0
    while i < len(rest):
        word = rest[i]
        if word.startswith("-"):
            # ключи со значением, после которых идёт не ссылка
            if word in ("--repo", "--exec", "--receive-pack", "-o",
                        "--push-option"):
                i += 2
                continue
            i += 1
            continue
        if not remote_seen:
            remote_seen = True  # первое не-ключевое слово — удалённый
        else:
            refs.append(word)
        i += 1

    if not refs:
        branch = g.current_branch(request)
        return [branch] if branch else []

    out = []
    for ref in refs:
        dst = ref.split(":")[-1]          # HEAD:main -> main, :main -> main
        dst = dst.lstrip("+")             # +develop -> develop
        if dst.startswith("refs/heads/"):
            dst = dst[len("refs/heads/"):]
        if dst:
            out.append(dst)
    return out


def main() -> None:
    request = g.read_request()
    command = g.bash_command(request)
    if not command:
        return g.silent()

    shared = g.setting(request, "shared_branches", DEFAULT_SHARED)

    for words in g.commands(command):
        rest = g.git_subcommand(words, "push")
        if rest is None:
            continue
        hit = [b for b in target_branches(rest, request) if b in shared]
        if not hit:
            continue
        names = ", ".join(sorted(set(hit)))
        return g.ask(
            f"Пуш в общую ветку: {names}.\n"
            f"Правило `process-git-branches`: в общие ветки — только через "
            f"слияние ветки задачи и только с явным разрешением человека, и "
            f"разрешение спрашивается каждый раз.\n"
            f"Разрешить именно этот пуш?"
        )
    return g.silent()


if __name__ == "__main__":
    main()

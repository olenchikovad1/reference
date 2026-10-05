"""Скиллы проекта попадают в сессию сами и напоминают о себе перед сдачей.

# event: SessionStart, Stop
# skill: quality-review
# wire: SessionStart matcher=startup|resume|clear|compact args=--index
# wire: Stop args=--check

Скиллы перечислены в окружении, но их текст появляется только когда его затребовали.
Работа «по памяти о правиле» соблюдает верхний уровень и теряет пункты: набор компонентов
использовался честно, а пункт того же правила про поведение списка нарушался девять раз
подряд, и заметил это человек, а не проверка.

Хук закрывает это с двух сторон, ничего не зашивая про конкретные скиллы — он **обходит
папку** `.claude/skills` и берёт то, что там лежит:

1. `--index` печатает перечень всех скиллов проекта: группа, к каким папкам относится,
   имена. Перечень попадает в контекст, поэтому «я не знал, что такой скилл есть»
   перестаёт быть возможным ответом.

   Вешается на `SessionStart` со всеми источниками — `startup|resume|clear|compact`.
   Сжатие контекста здесь главный случай: после него в памяти остаётся выжимка беседы, и
   перечень скиллов выпадает из неё первым — он не выглядит важным рядом с кодом. Ровно
   поэтому одного запуска «на старте» недостаточно: длинная сессия переживает несколько
   сжатий, и без повторной подачи вторая её половина работает уже без скиллов.
2. `--check` перед завершением хода сверяет изменённые файлы с тем, какие скиллы в этой
   сессии открывались (по транскрипту), и называет неоткрытые скиллы затронутых областей.

Область скилла берётся, в порядке убывания надёжности:

- поле `applies_to` во frontmatter скилла (список путей-шаблонов) — если оно есть;
- иначе первая часть имени каталога до дефиса (`frontend-*`, `backend-*`, `ops-*`) и
  соответствие этой части папкам проекта из `.claude/rails.json` (`skill_areas`);
- иначе скилл считается общим: он не привязан к папке и в напоминании не участвует.

Так добавление нового скилла или новой папки не требует правки хука: достаточно положить
каталог со `SKILL.md` или дописать соответствие в `rails.json`.

Отвечает предупреждением, а не остановкой: правки уже сделаны, останавливать нечего, а
текст нужен тому, кто правил.
"""

import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import _guard_common as g  # noqa: E402

# Соответствие «часть имени скилла → папки проекта» по умолчанию. Не список скиллов, а
# правило перевода: скиллы приходят и уходят, папки живут дольше.
DEFAULT_AREAS: dict[str, list[str]] = {
    "frontend": ["web/"],
    "backend": ["backend/"],
    "api": ["backend/app/api/"],
    "data": ["backend/app/models/", "backend/app/repo/", "backend/alembic/"],
    "architecture": ["backend/app/", "web/src/"],
    "ops": ["deploy/", "docker-compose.yml", "docker-compose.dev.yml"],
    "docs": ["manifest/", "README.md", "CLAUDE.md"],
}


def frontmatter(text: str) -> dict[str, str]:
    """Заголовок скилла как словарь. Без разбора yaml: нужны две-три строки, а не формат."""
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    if end == -1:
        return {}
    head: dict[str, str] = {}
    for line in text[3:end].splitlines():
        if ":" not in line or line.startswith(" "):
            continue
        key, value = line.split(":", 1)
        head[key.strip()] = value.strip()
    return head


def skills(root: Path) -> list[dict]:
    """Все скиллы проекта: обход папки, а не перечень в коде."""
    found: list[dict] = []
    for path in sorted((root / ".claude" / "skills").glob("*/SKILL.md")):
        text = path.read_text(encoding="utf-8", errors="replace")
        head = frontmatter(text)
        name = head.get("name") or path.parent.name
        applies = [item.strip() for item in head.get("applies_to", "").split(",") if item.strip()]
        found.append(
            {
                "name": name,
                "dir": path.parent.name,
                "group": path.parent.name.split("-", 1)[0],
                "applies_to": applies,
                "description": head.get("description", ""),
            }
        )
    return found


def areas(request: dict) -> dict[str, list[str]]:
    return g.setting(request, "skill_areas", DEFAULT_AREAS)


def paths_of(skill: dict, mapping: dict[str, list[str]]) -> list[str]:
    """К каким путям проекта относится скилл. Пусто — скилл общий."""
    if skill["applies_to"]:
        return skill["applies_to"]
    return mapping.get(skill["group"], [])


def changed_files(root: Path) -> list[str]:
    out: set[str] = set()
    for args in (
        ["git", "diff", "--name-only", "HEAD"],
        ["git", "ls-files", "--others", "--exclude-standard"],
    ):
        try:
            result = subprocess.run(args, cwd=root, capture_output=True, text=True, timeout=10)
        except Exception:
            continue
        for name in result.stdout.splitlines():
            if name.strip():
                out.add(name.strip().replace("\\", "/"))
    return sorted(out)


def loaded_skills(transcript: str) -> set[str]:
    """Какие скиллы открывались в этой сессии — по транскрипту.

    Читается сырой текст: формат записей меняется между версиями инструмента, а имя скилла
    в вызове выглядит одинаково. Не нашли транскрипт — считаем, что не открывался ни один:
    напоминание в этом случае лишнее, но не вредное.
    """
    if not transcript:
        return set()
    try:
        text = Path(transcript).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return set()
    return set(re.findall(r'"skill"\s*:\s*"([\w:-]+)"', text)) | set(
        re.findall(r"<command-name>/([\w:-]+)</command-name>", text)
    )


def shadowed(root: Path) -> list[str]:
    """Скиллы проекта, у которых есть личная копия — она и загрузится вместо проектной.

    Личная копия перекрывает проектную по правилам инструмента, и это нормально: она
    существует для того, у кого проектной нет. Ненормально другое — перекрытие не видно.
    Правку правила в проектной копии тогда не читает никто: по имени открывается личная, и
    новый пункт в ней просто отсутствует. Проверено дорого: два правила, дописанных в
    проектные копии, в этой же сессии не доехали до работы.
    """
    home = Path.home() / ".claude" / "skills"
    if not home.is_dir():
        return []
    mine = {path.parent.name for path in home.glob("*/SKILL.md")}
    theirs = {path.parent.name for path in (root / ".claude" / "skills").glob("*/SKILL.md")}
    return sorted(mine & theirs)


def index_text(root: Path, request: dict) -> str:
    mapping = areas(request)
    rows = skills(root)
    if not rows:
        return ""
    lines = [
        f"Скиллы проекта ({len(rows)}). Правило `quality-review`: перед правкой "
        "области её скиллы загружаются, а не вспоминаются — текст появляется только когда его "
        "затребовали.",
    ]
    by_group: dict[str, list[dict]] = {}
    for skill in rows:
        by_group.setdefault(skill["group"], []).append(skill)
    for group in sorted(by_group):
        where = ", ".join(paths_of(by_group[group][0], mapping)) or "общее"
        names = ", ".join(skill["dir"] for skill in by_group[group])
        lines.append(f"- {group} ({where}): {names}")
    covered = shadowed(root)
    if covered:
        lines.append(
            f"Перекрыты личными копиями ({len(covered)}): {', '.join(covered)} — по имени "
            "откроется личная копия, и правки проектной в неё не попадут. Правило правится "
            "в обеих или переносится."
        )
    return "\n".join(lines)


def check_text(root: Path, request: dict) -> str:
    mapping = areas(request)
    files = changed_files(root)
    if not files:
        return ""
    opened = loaded_skills(request.get("transcript_path", ""))
    missing: list[str] = []
    for skill in skills(root):
        prefixes = paths_of(skill, mapping)
        if not prefixes:
            continue
        if not any(name.startswith(prefix) for prefix in prefixes for name in files):
            continue
        if skill["dir"] in opened or skill["name"] in opened:
            continue
        missing.append(skill["dir"])
    if not missing:
        return ""
    # Напоминание сжимается по группам и обрезается по три имени.
    #
    # Перечень из тринадцати скиллов не читают, а непрочитанное напоминание хуже
    # отсутствующего: оно создаёт вид, что проверка работает. Группа плюс несколько имён
    # отвечает на вопрос «куда смотреть», а полный перечень и так печатается на старте.
    by_group: dict[str, list[str]] = {}
    for name in missing:
        by_group.setdefault(name.split("-", 1)[0], []).append(name)
    parts = []
    for group in sorted(by_group):
        names = by_group[group]
        rest = f" и ещё {len(names) - 3}" if len(names) > 3 else ""
        parts.append(f"{group}: {', '.join(names[:3])}{rest}")
    touched = ", ".join(sorted({name.split("/")[0] for name in files})[:6])
    return (
        f"quality-review: правки затронули {touched}, а скиллы этих областей "
        f"в сессии не открывались — {'; '.join(parts)}.\n"
        "Загрузить нужные и сверить правку — быстрее, чем разбирать последствия: правило "
        "теряется пунктами, а не целиком."
    )


def main() -> None:
    argv = sys.argv[1:]
    request = g.read_request()
    root = g.project_dir(request)
    text = index_text(root, request) if "--index" in argv else check_text(root, request)
    if text:
        print(text)
    raise SystemExit(0)


if __name__ == "__main__":
    main()

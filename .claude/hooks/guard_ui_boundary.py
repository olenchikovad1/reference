"""Компоненты живут в одном месте, чужая библиотека — внутри них.

# event: PreToolUse
# skill: frontend-ui
# wire: PreToolUse matcher=Write|Edit|MultiEdit
# wire: PostToolUse matcher=Bash|Write|Edit|MultiEdit args=--changed

Правило `frontend-component-library` говорит: набор компонентов один, экраны
берут элементы оттуда, своей папки компонентов у экрана нет. Пока это держится
памятью, оно не держится: экран, которому «нужно чуть иначе», заводит рядом свою
таблицу, и через месяц их снова двадцать шесть.

Хук закрывает два обхода, которые видно машинно:

1. **Импорт сторонней библиотеки компонентов вне набора.** Если экран импортирует
   примитивы напрямую, он оказывается написан на чужом API, и заменить реализацию
   уже нельзя, не тронув экраны. Внутри `components/ui` это законно — там она и
   должна быть деталью реализации.
2. **Вторая папка компонентов.** Каталог `ui` или `components` вне
   `web/src/components` — это и есть начало расхождения.

Отвечает `deny`, а не `ask`: последствие не дорогое, но и решать тут нечего —
импорт переносится внутрь набора, и вопрос закрыт. Запуск без stdin работает как
проверка всего дерева, чтобы то же правило можно было прогнать перед слиянием:

    py -X utf8 .claude/hooks/guard_ui_boundary.py --scan

Раскладка фронтенда и список библиотек берутся из `.claude/rails.json`
(`frontend_src`, `ui_set_dir`, `ui_root_dir`, `component_libraries`).
"""

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import _guard_common as g  # noqa: E402

# Раскладка фронтенда. Зашивать её нельзя по той же причине, по которой не зашит
# список библиотек: набор компонентов лежит где-то в `web/src/components/ui`, где-то
# в `frontend/src/shared/ui`, а заготовка одна на все проекты. Хук с чужой раскладкой
# не ошибается заметно — он молча не находит ни одного файла фронтенда и создаёт
# ощущение, что правило подпёрто.
DEFAULT_SRC = "web/src"


def layout(request: dict | None = None) -> dict[str, str]:
    """Где лежит фронтенд, где набор компонентов и где его корень.

    Каждое значение берётся из `rails.json` отдельным ключом, а не одним словарём:
    настройка заменяет умолчание целиком (см. `_guard_common.setting`), и словарём
    пришлось бы каждый раз перечислять все три пути, даже меняя один.
    """
    request = request or {}
    src = g.setting(request, "frontend_src", DEFAULT_SRC)
    return {
        "src": src.rstrip("/"),
        "set": g.setting(request, "ui_set_dir", f"{src.rstrip('/')}/components/ui"),
        "root": g.setting(request, "ui_root_dir", f"{src.rstrip('/')}/components"),
    }

# Библиотеки, из которых собираются компоненты. Список в rails.json, чтобы
# добавление примитива не требовало правки хука.
DEFAULT_LIBRARIES = [
    "@radix-ui/",
    "@tanstack/react-table",
    "@headlessui/",
    "antd",
    "@mui/",
    "@chakra-ui/",
    "react-select",
]

IMPORT = re.compile(r"""(?:from|import)\s+['"]([^'"]+)['"]""")

# Блоки, для которых в наборе уже есть компонент. Экран, пишущий их руками, — это не
# «чуть иначе», а начало расхождения: галочки выбора строк и наборы чекбоксов уже
# разъезжались между страницей ячеек и страницей зон, пока не стали одним компонентом.
#
# Проверяется намеренно узко — по разметке, которую видно машинно. Ложное срабатывание
# здесь дороже пропуска: экран, которому галочка нужна не для выбора строк, существует.
HANDMADE = (
    (
        re.compile(r"""<input[^>]*type=["']checkbox["']"""),
        "рукописная галочка",
        "Checkbox из набора, а для выбора строк таблицы — selectionColumn/useRowSelection",
    ),
    (
        # Рукописная таблица в файле экрана — включая форму, разложенную по столбцам:
        # поля ввода живут в ячейках общей таблицы, а не в своей вёрстке. Исключение
        # «это же форма, а не список» проверено дорого: под него уехали восемь таблиц, и
        # каждая разошлась с остальными на своё поле, свой отступ, своё пустое состояние.
        re.compile(r"<table[\s>]"),
        "рукописная таблица",
        "таблица из набора компонентов",
    ),
    # Проектные признаки добавляются сюда же: пара «регулярка — чем заменить». Пример
    # из проекта, откуда хук пришёл: `storageClasses.map(...)<Checkbox` → StorageClassSet.
    # Регулярка должна быть узкой: тот же перебор справочника законно раскладывается в
    # опции Select, и ложное срабатывание здесь дороже пропуска.
)


# Выключенное поведение списка. Общая таблица даёт постраничность, сортировку, пустое
# состояние и загрузку по умолчанию — их надо осознанно выключать, а не включать. Значит и
# выключение должно быть видно как решение: рядом с ним причина.
PAGINATION_OFF = re.compile(r'pagination=["\']off["\']')
JUSTIFIED = re.compile(r'(?:Постраничность выключена|постраничност[ьи][^\n]{0,80}выключен)')


def unjustified_pagination_off(text: str) -> int:
    """Сколько выключений постраничности не объяснено ни одной строкой рядом.

    Ищется не «есть ли комментарий в файле», а комментарий В ПРЕДЕЛАХ пяти строк над
    выключением: файл экрана большой, и объяснение из другого его конца ничего не
    объясняет.
    """
    lines = text.split("\n")
    count = 0
    for index, line in enumerate(lines):
        if not PAGINATION_OFF.search(line):
            continue
        window = "\n".join(lines[max(0, index - 5) : index])
        if not JUSTIFIED.search(window):
            count += 1
    return count


def handmade_blocks(text: str) -> list[tuple[str, str]]:
    """Что написано руками и чем это заменяется. Пусто — нарушений нет."""
    return [(name, instead) for pattern, name, instead in HANDMADE if pattern.search(text)]


def offending_imports(text: str, libraries: list[str]) -> list[str]:
    found = []
    for module in IMPORT.findall(text):
        for lib in libraries:
            if module == lib.rstrip("/") or module.startswith(lib):
                found.append(module)
                break
    return sorted(set(found))


def inside_ui(path: str, lay: dict[str, str]) -> bool:
    return lay["set"] in path.replace("\\", "/")


def is_frontend(path: str, lay: dict[str, str]) -> bool:
    normalized = path.replace("\\", "/")
    return f"{lay['src']}/" in normalized and normalized.endswith((".ts", ".tsx"))


def scan(root: Path, libraries: list[str], lay: dict[str, str]) -> list[str]:
    """Нарушения по всему дереву. Пусто — правило соблюдено."""
    problems: list[str] = []
    src = root / lay["src"]
    if not src.exists():
        return problems

    for path in sorted(src.rglob("*.ts*")):
        posix = path.as_posix()
        if inside_ui(posix, lay):
            continue
        text = path.read_text(encoding="utf-8")
        modules = offending_imports(text, libraries)
        if modules:
            problems.append(f"{posix}: импорт {', '.join(modules)} вне набора компонентов")
        for name, instead in handmade_blocks(text):
            problems.append(f"{posix}: {name} — вместо этого {instead}")
        unjustified = unjustified_pagination_off(text)
        if unjustified:
            problems.append(
                f"{posix}: постраничность выключена без причины ({unjustified} шт.) — "
                f"либо включить, либо записать рядом, почему список ограничен по природе"
            )

    for path in sorted(src.rglob("*")):
        if not path.is_dir():
            continue
        posix = path.as_posix()
        if path.name in ("ui", "components") and not posix.endswith(
            (lay["root"], lay["set"])
        ):
            problems.append(f"{posix}: вторая папка компонентов — набор должен быть один")
    return problems


def changed_files(root: Path) -> list[Path]:
    """Файлы, изменённые относительно HEAD, включая ещё не добавленные в индекс."""
    import subprocess

    found: set[Path] = set()
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
                found.add(root / name.strip())
    return sorted(path for path in found if path.exists())


def problems_in(text: str, posix: str, libraries: list[str]) -> list[str]:
    problems: list[str] = []
    modules = offending_imports(text, libraries)
    if modules:
        problems.append(f"{posix}: импорт {', '.join(modules)} вне набора компонентов")
    for name, instead in handmade_blocks(text):
        problems.append(f"{posix}: {name} — вместо этого {instead}")
    unjustified = unjustified_pagination_off(text)
    if unjustified:
        problems.append(
            f"{posix}: постраничность выключена без причины ({unjustified} шт.) — либо "
            f"включить, либо записать рядом, почему список ограничен по природе"
        )
    return problems


def main() -> None:
    argv = sys.argv[1:]
    if "--changed" in argv:
        # Проверка ПОСЛЕ правки и только по изменённому.
        #
        # Зачем отдельный режим. Проверка на PreToolUse читает аргументы инструмента и
        # потому видит правки только через Write/Edit. Правка тем же файлом из скрипта в
        # оболочке до неё не доходит вовсе — правило молча не работает ровно у того, кто
        # правит скриптами. Разбор показал: за целую сессию правок фронтенда хук не
        # сработал ни разу, и три экрана уехали в обход набора компонентов.
        root = Path.cwd()
        # Настройки проекта нужны и здесь: без них проверка изменённого работала бы
        # по умолчаниям заготовки, то есть не по этому проекту.
        lay = layout()
        libraries = g.setting({}, "component_libraries", DEFAULT_LIBRARIES)
        problems: list[str] = []
        for path in changed_files(root):
            posix = path.as_posix()
            if not is_frontend(posix, lay) or inside_ui(posix, lay):
                continue
            problems += problems_in(path.read_text(encoding="utf-8"), posix, libraries)
        if problems:
            # Предупреждение, а не остановка: правка уже сделана, останавливать нечего, а
            # текст нужен тому, кто правил, — чтобы починить в этом же ходу.
            print("frontend-component-library — проверьте изменённое:")
            for line in problems:
                print(" ", line)
        raise SystemExit(0)

    if "--scan" in argv:
        root = Path.cwd()
        problems = scan(root, g.setting({}, "component_libraries", DEFAULT_LIBRARIES),
                        layout())
        for line in problems:
            print(line)
        print("нарушений:", len(problems))
        raise SystemExit(1 if problems else 0)

    request = g.read_request()
    if request.get("tool_name") not in ("Write", "Edit", "MultiEdit", "NotebookEdit"):
        return
    payload = request.get("tool_input") or {}
    path = payload.get("file_path") or ""
    lay = layout(request)
    if not is_frontend(path, lay) or inside_ui(path, lay):
        return

    libraries = g.setting(request, "component_libraries", DEFAULT_LIBRARIES)
    # Проверяется то, что собираются записать: и целиком (Write), и заменой (Edit).
    written = "\n".join(
        str(payload.get(key) or "")
        for key in ("content", "new_string", "new_source")
    )
    handmade = handmade_blocks(written)
    if handmade:
        names = ", ".join(name for name, _ in handmade)
        instead = "; ".join(f"{name} → {use}" for name, use in handmade)
        g.deny(
            f"В файле экрана {names}.\n"
            f"Правило `frontend-component-library`: то, что уже есть в наборе, экран не "
            f"пишет руками — иначе копия расходится с оригиналом на одну деталь за "
            f"правку, и к моменту, когда это замечают, копий уже шесть.\n"
            f"Возьмите: {instead}.\n"
            f"Если случай действительно другой — добавьте параметр в компонент набора, "
            f"а не вторую реализацию рядом."
        )
        return

    modules = offending_imports(written, libraries)
    if not modules:
        return

    g.deny(
        f"Импорт {', '.join(modules)} вне набора компонентов ({lay['set']}).\n"
        f"Правило `frontend-component-library`: экран берёт готовый компонент из "
        f"набора, а сторонняя библиотека остаётся деталью реализации внутри него — "
        f"иначе экраны оказываются написаны на чужом API, и заменить его нельзя, "
        f"не переписав экраны.\n"
        f"Заведи или дополни компонент в наборе и подключи его на экране."
    )


if __name__ == "__main__":
    main()

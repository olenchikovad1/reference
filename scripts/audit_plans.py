"""Индекс планов Reference с проверкой опубликованных коммитов.

Хост, стандартная библиотека: python scripts/audit_plans.py --plans <общий каталог>.
Состояние в заголовке и наличие кода не заменяют пользовательскую приёмку:
скрипт показывает их раздельно и сам планы не закрывает.
"""

import argparse
import json
from pathlib import Path
import re
import subprocess


def inspect_plans(root: Path) -> dict:
    plans = []
    related = []
    for path in sorted(root.glob("*.md")):
        content = path.read_text(encoding="utf-8-sig")
        header = content.split("---", 2)[1] if content.startswith("---") else ""
        project = re.search(r"^project:\s*(.+)$", header, re.M)
        status = re.search(r"^status:\s*(.+)$", header, re.M)
        title = re.search(r"^# (.+)$", content, re.M)
        if project and project.group(1).strip() == "reference":
            commits = []
            for commit in sorted(set(re.findall(r"`([a-f0-9]{7,40})`", content))):
                known = subprocess.run(["git", "cat-file", "-e", commit + "^{commit}"], capture_output=True)
                if known.returncode == 0:
                    published = subprocess.run(["git", "merge-base", "--is-ancestor", commit, "origin/master"], capture_output=True)
                    commits.append({"commit": commit, "in_origin_master": published.returncode == 0})
            plans.append({"file": path.name, "title": title.group(1) if title else path.stem,
                          "status": status.group(1).strip() if status else "unknown",
                          "stories": re.findall(r"^## (US-\d+)\.", content, re.M), "commits": commits})
        elif re.search(r"Reference|Референс|референс|^projects:.*\breference\b", content, re.M):
            related.append({"file": path.name, "status": status.group(1).strip() if status else "unknown"})
    return {"project": "reference", "plans": plans, "related_shared_plans": related}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plans", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = inspect_plans(args.plans)
    rendered = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(rendered, encoding="utf-8")
    else:
        print(rendered)

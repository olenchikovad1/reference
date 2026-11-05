"""Выбор по риску и доказанным входам (TC-2026-11-05 v1.0.0)."""
from dataclasses import dataclass
from fnmatch import fnmatchcase
import hashlib
import json
from pathlib import Path
import random


@dataclass(frozen=True)
class Group:
    id: str
    tests: list[str]
    areas: list[str]
    core: bool
    cost: float
    category: str
    command: list[str]
    runtime: str = 'host'
    risk: str = ''


def fingerprint(root: Path, patterns: list[str], environment: dict) -> str | None:
    """Содержимое и фактическая среда; неизвестный вход запрещает reuse."""
    if not environment or any(value is None for value in environment.values()):
        return None
    files: set[Path] = set()
    for pattern in patterns:
        # До Python 3.13 завершающий ** перечислял только каталоги.
        if pattern.endswith('/**'):
            pattern += '/*'
        matches = [path for path in root.glob(pattern) if path.is_file() and '__pycache__' not in path.parts
                   and path.suffix not in {'.pyc', '.pyo'} and path.name != '.env']
        if not matches:
            return None
        files.update(matches)
    digest = hashlib.sha256(json.dumps(environment, sort_keys=True, separators=(',', ':')).encode())
    for path in sorted(files, key=lambda item: item.relative_to(root).as_posix()):
        digest.update(path.relative_to(root).as_posix().encode() + b'\0')
        with path.open('rb') as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(block)
    return digest.hexdigest()


def reusable(record: dict, current: str | None, *, now: float, max_age: float, reasons: list[str] | None = None) -> bool:
    return bool('unknown_influence' not in (reasons or []) and current and record.get('fingerprint') == current and record.get('evidence')
                and not record.get('failed') and record.get('last_success') is not None
                and 0 <= now - record['last_success'] < max_age)


def accepted(results: list[dict], selected: list[str]) -> bool:
    if not selected or len(results) != len(selected) or {row['id'] for row in results} != set(selected):
        return False
    return all((row['status'] == 'executed' and row.get('tests', 0) > 0)
               or (row['status'] == 'reused' and row.get('source_evidence') and row.get('last_success') is not None)
               for row in results)


def select(groups: list[Group], changed: list[str], history: dict, inputs: dict, *, now: float,
           max_age: float, budget: float, seed: int, regressions: list[str] | None = None) -> dict[str, list[str]]:
    if not groups or len({group.id for group in groups}) != len(groups):
        raise ValueError('Каталог пуст или содержит повторные ID')
    ids = {group.id for group in groups}
    if set(regressions or []) - ids:
        raise ValueError('Неизвестный ID регрессии')
    common = ['scripts/testing/**', 'scripts/stand/verify_testing_contract.py', 'installation.unit.toml', 'deploy/**', 'infra/compose*', '.github/workflows/**', 'AGENTS.md', 'CLAUDE.md']
    ignored = ['docs/**', 'README.md', 'scripts/README.md', '.gitignore', '.gitattributes']
    unknown = [path for path in changed if not any(fnmatchcase(path, pattern)
               for pattern in common + ignored + [area for group in groups for area in group.areas + group.tests])]
    chosen: dict[str, list[str]] = {}
    for group in groups:
        previous = history.get(group.id, {})
        reasons = []
        if group.core:
            reasons.append('core')
        if group.id in (regressions or []):
            reasons.append('regression')
        if previous.get('failed'):
            reasons.append('previous_failure')
        if unknown:
            reasons.append('unknown_influence')
        if any(fnmatchcase(path, pattern) for path in changed for pattern in common + group.areas + group.tests):
            reasons.append('affected')
        if not inputs.get(group.id) or previous.get('fingerprint') != inputs.get(group.id):
            reasons.append('inputs_changed')
        if previous.get('last_success') is None or now - previous['last_success'] >= max_age:
            reasons.append('due_rotation')
        if reasons:
            chosen[group.id] = reasons
    # Обязательное не обрезается бюджетом. Остальное — по давности, seed только для равной давности.
    remaining = [group for group in groups if group.id not in chosen]
    random.Random(seed).shuffle(remaining)
    remaining.sort(key=lambda group: history.get(group.id, {}).get('last_success', 0))
    cost = sum(group.cost for group in groups if group.id in chosen)
    for group in remaining:
        if cost + group.cost <= budget:
            chosen[group.id] = ['rotation_budget']
            cost += group.cost
    return chosen

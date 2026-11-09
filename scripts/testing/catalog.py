"""Исполняемый каталог: каждый настоящий тест относится к стабильной группе."""
import ast
import json
from pathlib import Path

from scripts.testing.policy import Group


def load(root: Path) -> tuple[dict, list[Group]]:
    policy = json.loads((root / 'scripts/testing/catalog.json').read_text(encoding='utf-8'))
    groups = [Group('REF-POLICY', ['scripts/testing/test_*.py'], ['scripts/testing/**'], True, 2,
                    'unit', ['python', '-m', 'unittest', 'discover', '-s', 'scripts/testing', '-p', 'test_*.py'],
                    risk='Селектор не теряет обязательное, reuse не принимает неизвестное, ротация не голодает.')]
    for runtime, domain in policy['domains'].items():
        for path in sorted(root.glob(domain['tests'])):
            relative = path.relative_to(root).as_posix()
            if runtime == 'api':
                name = path.stem.removeprefix('test_')
                identity = 'REF-API-' + name
                risk = (ast.get_docstring(ast.parse(path.read_text(encoding='utf-8'))) or name).splitlines()[0]
                heavy = name in policy['heavy_api']
                command = ['python', '-m', 'pytest', '-q', relative.removeprefix('api/'), '--junitxml=/evidence/result.xml']
            else:
                name = relative.removeprefix('web/src/').split('.test.')[0].replace('/', '.')
                identity = 'REF-WEB-' + name
                risk = 'Редактор/пользовательский путь: ' + name
                heavy = False
                command = ['npm', 'test', '--', '--run', relative.removeprefix('web/'), '--reporter=json', '--outputFile=/evidence/result.json']
            core = identity in policy['core']
            category = ('model' if runtime == 'api' and name in policy['model_api'] else
                        'compute' if heavy else 'scenario' if runtime == 'api' else 'unit')
            groups.append(Group(identity, [relative], domain['areas'] + ['scripts/testing/**'], core,
                                180 if heavy else 15 if runtime == 'api' else 3,
                                category, command, runtime, risk))
    expected = set(policy['core']) - {group.id for group in groups}
    if expected:
        raise ValueError('Обязательные группы отсутствуют: ' + ', '.join(sorted(expected)))
    if len({group.id for group in groups}) != len(groups):
        raise ValueError('Повторные ID групп')
    models = {group.id.removeprefix('REF-API-') for group in groups if group.category == 'model'}
    if models != set(policy['model_api']) or any(group.core for group in groups if group.category == 'model'):
        raise ValueError('Модельный профиль должен ссылаться на отдельные существующие группы')
    return policy, groups


def profile_groups(groups: list[Group], stage: str) -> list[Group]:
    """Настоящие модели проверяются только явно запрошенным профилем."""
    return [group for group in groups if (group.category == 'model') == (stage == 'models')]

#!/usr/bin/env python3
"""Контрольная демонстрация TC-ADOPT-012 без Docker и рабочих данных.

Оператор видит настоящий успешный процесс, reuse без второго запуска,
отказ после изменения входа и конечный обход моделируемой истории.
Это проверка инфраструктурного договора, не подстановка API-сценария.
"""
import argparse
import json
from pathlib import Path
import platform
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from scripts.testing.policy import Group, accepted, fingerprint, reusable, select
from scripts.testing.runtime import command


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    if (output / 'control.json').exists():
        raise ValueError('Do not overwrite the first control evidence')
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix='tc-control-', dir=output) as directory:
        root = Path(directory)
        case = root / 'test_control.py'
        case.write_text('import unittest\nclass Control(unittest.TestCase):\n def test_value(self): self.assertEqual(6*7,42)\n', encoding='utf-8')
        environment = {'python':platform.python_version(), 'selector':'1.0.0'}
        original = fingerprint(root, ['test_control.py'], environment)
        process = [sys.executable, '-B', '-m', 'unittest', 'discover', '-s', str(root), '-p', 'test_control.py']
        code, log, positive_seconds = command(process, cwd=ROOT, timeout=30)
        (output / 'positive.log').write_text(log, encoding='utf-8')
        positive = accepted([{'id':'CONTROL', 'status':'executed' if code == 0 else 'failed', 'tests':1}], ['CONTROL'])
        if not positive:
            raise RuntimeError('Synthetic positive control failed')
        record = {'fingerprint':original, 'last_success':time.time(), 'evidence':'positive.log', 'failed':False}
        calls = 1
        unchanged = reusable(record, fingerprint(root, ['test_control.py'], environment), now=time.time(), max_age=604800)
        if not unchanged:
            raise RuntimeError('Unchanged proven input unexpectedly rejected reuse')
        # Вторая проверка действительно не запускает процесс.
        calls_after_reuse = calls
        case.write_text('import unittest\nclass Control(unittest.TestCase):\n def test_value(self): self.assertEqual(7*7,42)\n', encoding='utf-8')
        changed = fingerprint(root, ['test_control.py'], environment)
        invalidated = not reusable(record, changed, now=time.time(), max_age=604800)
        code, log, negative_seconds = command(process, cwd=ROOT, timeout=30)
        calls += 1
        (output / 'first-failure.log').write_text(log, encoding='utf-8')
        refused = not accepted([{'id':'CONTROL', 'status':'failed' if code else 'executed', 'tests':1}], ['CONTROL'])
        if not invalidated or not refused or code == 0:
            raise RuntimeError('Controlled failing input was accepted')
        groups = [Group(str(index), ['case'], ['src/**'], False, 10, 'unit', []) for index in range(6)]
        history = {group.id:{'last_success':99, 'fingerprint':'same'} for group in groups}
        inputs = {group.id:'same' for group in groups}
        rotation = []
        covered = set()
        for now in range(100, 106):
            chosen = select(groups, [], history, inputs, now=now, max_age=1000, budget=10, seed=42)
            replay = select(groups, [], history, inputs, now=now, max_age=1000, budget=10, seed=42)
            if chosen != replay:
                raise RuntimeError('Recorded selection does not replay')
            rotation.append({'time':now, 'ids':list(chosen), 'seed':42})
            for identity in chosen:
                covered.add(identity)
                history[identity]['last_success'] = now
        if covered != set(inputs):
            raise RuntimeError('A group starved in modeled rotation')
        result = {'adoption':'TC-ADOPT-012', 'contract':'TC-2026-11-05', 'version':'1.0.0',
                  'positive':positive, 'unchanged_reused_without_execution':unchanged,
                  'calls_after_reuse':calls_after_reuse, 'calls_total':calls,
                  'changed_input_invalidated':invalidated, 'controlled_failure_refused':refused,
                  'first_failure':'first-failure.log', 'original_fingerprint':original, 'changed_fingerprint':changed,
                  'modeled_rotation':rotation, 'all_groups_covered':True,
                  'positive_seconds':positive_seconds, 'negative_seconds':negative_seconds,
                  'wall_seconds':time.monotonic() - started}
        (output / 'control.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(result))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

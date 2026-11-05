#!/usr/bin/env python3
"""Точка входа TC-ADOPT-012 для unit.test, кандидата и ежедневной ротации."""
import argparse
from contextlib import contextmanager
from dataclasses import replace
import json
import hashlib
import math
import os
from pathlib import Path
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from scripts.testing.catalog import load
from scripts.testing.policy import accepted, fingerprint, reusable, select, replay_selection
from scripts.testing.runtime import DockerRuntime, command


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


@contextmanager
def state_lock(path: Path):
    """Общий cache переживает checkout; два выпуска не теряют историю друг друга."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a+b') as stream:
        stream.seek(0)
        if path.stat().st_size == 0:
            stream.write(b'0'); stream.flush()
        stream.seek(0)
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def git(*args: str) -> str:
    code, text, _ = command(['git', *args], cwd=ROOT, timeout=30)
    if code:
        raise RuntimeError('Git input unavailable: ' + args[0])
    return text.strip()


def source_files() -> dict[str, str]:
    """Installation даёт shallow clone: сравниваем доказанное содержимое, не ancestry."""
    files = git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0')
    result = {}
    for name in filter(None, files):
        path = ROOT / name
        if not path.is_file() or not path.resolve().is_relative_to(ROOT):
            raise RuntimeError('Unknown source input: ' + name)
        result[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage', choices=['change', 'candidate', 'rotation'], default='change')
    parser.add_argument('--state-dir', type=Path, default=Path(os.environ.get('REFERENCE_TEST_STATE', str(Path.home() / '.cache/reference-testing'))))
    parser.add_argument('--output', type=Path)
    parser.add_argument('--changed', action='append', default=[])
    parser.add_argument('--base')
    parser.add_argument('--regression', action='append', default=[])
    parser.add_argument('--budget', type=float)
    parser.add_argument('--seed', type=int, default=20261105)
    parser.add_argument('--replay', type=Path)
    parser.add_argument('--image', action='append', default=[], metavar='api|web|tunnel=IMAGE')
    args = parser.parse_args()
    policy, groups = load(ROOT)
    run_id = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()) + '-' + uuid.uuid4().hex[:8]
    state_dir = args.state_dir.resolve()
    output = (args.output or state_dir / 'evidence' / run_id).resolve()
    if (output / 'evidence.json').exists():
        raise ValueError('Evidence immutable: choose a new output directory')
    output.mkdir(parents=True, exist_ok=True)
    images = dict(item.split('=', 1) for item in args.image)
    if args.stage == 'candidate' and set(images) != {'api', 'web', 'tunnel'}:
        raise ValueError('Candidate requires exact api/web/tunnel images')
    started = time.monotonic()
    evidence = {'project': 'reference', 'contract': policy['contract'], 'contract_version': policy['version'],
                'adoption': policy['adoption'], 'profile': policy['profile'], 'run_id': run_id,
                'stage': args.stage, 'seed': args.seed, 'results': [], 'not_applicable': policy['not_applicable'],
                'accepted': False, 'preparation_seconds': 0, 'execution_seconds': 0, 'errors': []}
    runtime = DockerRuntime(ROOT, state_dir, output, images)
    try:
        with state_lock(state_dir / 'lock'):
            state_path = state_dir / 'history.json'
            state = json.loads(state_path.read_text(encoding='utf-8')) if state_path.exists() else {'groups': {}}
            groups = [replace(group, cost=max(0.001, state['groups'].get(group.id, {}).get('measured_test_seconds', group.cost))) for group in groups]
            evidence.update(commit=git('rev-parse', 'HEAD'), tree=git('rev-parse', 'HEAD^{tree}'),
                            dirty=bool(git('status', '--porcelain', '--untracked-files=normal')))
            sources = source_files()
            changed = args.changed
            if not changed:
                previous_sources = state.get('accepted_files')
                if not args.base and previous_sources:
                    changed = sorted(name for name in set(sources) | set(previous_sources)
                                     if sources.get(name) != previous_sources.get(name))
                elif args.base:
                    base = args.base
                    code, text, _ = command(['git', 'diff', '--name-only', base, '--'], cwd=ROOT, timeout=30)
                    changed = text.splitlines() if code == 0 else ['unknown-history']
                else:
                    changed = ['unknown-history']
            # Подготовка/зависимости учитываются во времени, даже если тесты затем reused.
            preparation_started = time.monotonic()
            try:
                runtime.prepare()
            finally:
                evidence['preparation_seconds'] = time.monotonic() - preparation_started
            inputs, versions = {}, {}
            for group in groups:
                patterns = group.tests + group.areas + ['scripts/testing/**']
                if group.runtime == 'api':
                    patterns += ['api/tests/**']
                inputs[group.id] = fingerprint(ROOT, patterns, runtime.environments[group.runtime])
                versions[group.id] = fingerprint(ROOT, group.tests, {'selector': '1.0.0'})
            budget = args.budget if args.budget is not None else policy['budget_seconds']
            if not math.isfinite(budget) or budget < 0:
                raise ValueError('Budget must be nonnegative')
            now = time.time()
            chosen = select(groups, changed, state['groups'], inputs, now=now, max_age=policy['max_age_seconds'],
                            budget=budget, seed=args.seed, regressions=policy.get('regressions', []) + args.regression)
            if args.replay:
                original = json.loads(args.replay.read_text(encoding='utf-8'))
                chosen = replay_selection(chosen, original, inputs, args.seed)
            evidence.update(changed=changed, inputs=inputs, test_versions=versions, selected_ids=list(chosen),
                            selection_reasons=chosen, budget_seconds=budget,
                            environments=runtime.environments, selector_version='1.0.0',
                            not_selected=[{'id':group.id, 'reason':'unchanged inputs and not due; outside rotation budget'}
                                          for group in groups if group.id not in chosen])
            evidence['source_files'] = sources
            evidence['catalog'] = [{'id':group.id, 'tests':group.tests, 'category':group.category,
                                    'risk':group.risk, 'core':group.core} for group in groups]
            evidence['computation_cache'] = {'inputs':runtime.derived_descriptor,
                                             'receipt':str(runtime.derived / 'receipt.json'),
                                             'boundary':'Model computation artifacts, never inferred test success.'}
            pending = []
            for group in groups:
                if group.id not in chosen:
                    continue
                old = state['groups'].get(group.id, {})
                source = Path(old['evidence']) if old.get('evidence') else None
                origin = json.loads(source.read_text(encoding='utf-8')) if source and source.is_file() else {}
                proven = origin.get('inputs', {}).get(group.id) == inputs[group.id] and any(
                    row['id'] == group.id and row['status'] == 'executed' and row.get('tests', 0) > 0
                    for row in origin.get('results', []))
                if proven and reusable(old, inputs[group.id], now=now, max_age=policy['max_age_seconds'], reasons=chosen[group.id]):
                    evidence['results'].append({'id':group.id, 'status':'reused', 'source_evidence':old['evidence'],
                                               'last_success':old['last_success'], 'reason':'same content, resolved dependencies, tool environment, configuration and data; unexpired success',
                                               'duration_seconds':0})
                else:
                    pending.append(group)
            for environment in ['host', 'web', 'api']:
                batch = [group for group in pending if group.runtime == environment]
                if not batch:
                    continue
                print(f'TC-ADOPT-012: {environment}, {len(batch)} groups', flush=True)
                results, elapsed = runtime.execute(batch, environment)
                evidence['execution_seconds'] += elapsed
                for group in batch:
                    result = {'id':group.id, **results[group.id]}
                    evidence['results'].append(result)
                    previous = state['groups'].get(group.id, {})
                    passed = result['status'] == 'executed' and result['tests'] > 0
                    state['groups'][group.id] = {
                        'fingerprint':inputs[group.id], 'test_version':versions[group.id],
                        'last_success':time.time() if passed else previous.get('last_success'),
                        'failed':not passed, 'evidence':str(output / 'evidence.json') if passed else previous.get('evidence'),
                        'first_failure':previous.get('first_failure') or (run_id if not passed else None),
                        'measured_test_seconds':result['test_seconds'],
                    }
                    write_json(state_path, state)
            if args.stage == 'candidate' and accepted(evidence['results'], list(chosen)):
                print('TC-ADOPT-012: immutable candidate and two-machine HTTP contract', flush=True)
                candidate = runtime.candidate()
                evidence['candidate'] = candidate
                evidence['execution_seconds'] += candidate['duration_seconds']
            evidence['rotation'] = {group.id:{'last_success':state['groups'].get(group.id, {}).get('last_success'),
                                              'version':versions[group.id],
                                              'due':state['groups'].get(group.id, {}).get('last_success') is None
                                                    or time.time() - (state['groups'].get(group.id, {}).get('last_success') or 0) >= policy['max_age_seconds']}
                                    for group in groups}
            evidence['accepted'] = accepted(evidence['results'], list(chosen))
            if args.stage == 'candidate' and not evidence.get('candidate', {}).get('accepted'):
                evidence['accepted'] = False
            if evidence['accepted'] and not evidence['dirty']:
                state['accepted_commit'] = evidence['commit']
                state['accepted_files'] = sources
            write_json(state_path, state)
    except (OSError, ValueError, RuntimeError, KeyError) as failure:
        evidence['errors'].append(str(failure))
        evidence['accepted'] = False
    finally:
        runtime.close()
        evidence['wall_seconds'] = time.monotonic() - started
        evidence['budget_exceeded'] = evidence['wall_seconds'] > evidence.get('budget_seconds', policy['budget_seconds'])
        evidence['budget_note'] = 'Mandatory groups were not trimmed; preparation is included.'
        write_json(output / 'evidence.json', evidence)
    print(json.dumps({'adoption':policy['adoption'], 'accepted':evidence['accepted'], 'evidence':str(output / 'evidence.json'),
                      'wall_seconds':round(evidence['wall_seconds'],3), 'errors':evidence['errors']}, ensure_ascii=False), flush=True)
    return 0 if evidence['accepted'] else 1


if __name__ == '__main__':
    raise SystemExit(main())

"""Контрольные исходы TC-ADOPT-012, без Docker и рабочих данных."""
import tempfile
import unittest
from pathlib import Path
import ipaddress
import json
from unittest.mock import patch

from scripts.testing.policy import Group, accepted, fingerprint, select, reusable, replay_selection
from scripts.testing.runtime import DockerRuntime, free_subnet, image_runtime


class StrategyTests(unittest.TestCase):
    def test_image_metadata_does_not_repeat_checks_but_runtime_changes_do(self):
        image = {'Id':'first', 'RootFS':{'Layers':['one']}, 'Config':{'Env':['MODE=test']}, 'Architecture':'amd64', 'Os':'linux'}
        self.assertEqual(image_runtime(image), image_runtime({**image,'Id':'second','Created':'other'}))
        self.assertNotEqual(image_runtime(image), image_runtime({**image,'RootFS':{'Layers':['different']}}))
        self.assertNotEqual(image_runtime(image), image_runtime({**image,'Config':{'Env':['MODE=other']}}))
        with self.assertRaises(ValueError):
            image_runtime({'Id':'only-tag-is-known'})

    def test_replay_cannot_bypass_unknown_impact_or_new_mandatory_checks(self):
        original = {'selected_ids':['one'], 'inputs':{'one':'same'}, 'seed':42,
                    'selection_reasons':{'one':['core']}}
        self.assertEqual(replay_selection({'one':['core','affected']}, original, {'one':'same'}, 42),
                         {'one':['core','affected']})
        for current in [{'one':['unknown_influence']}, {'one':['core'],'new':['due_rotation']}]:
            with self.assertRaises(ValueError):
                replay_selection(current, original, {'one':'same'}, 42)

    def test_runner_failure_outside_assertions_cannot_become_success(self):
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as directory:
            root = Path(directory)
            for environment in ['web', 'api']:
                with self.subTest(environment=environment):
                    runtime = DockerRuntime(root, root / 'state', root / environment, {})
                    group = Group('case', [environment + '/tests/test_case.py'], [], True, 1, 'unit', [], environment)
                    def failed_process(*args, runtime=runtime, environment=environment, **kwargs):
                        destination = runtime.output / environment
                        if environment == 'web':
                            (destination / 'result.json').write_text(json.dumps({'testResults':[
                                {'name':'/app/tests/test_case.py','status':'passed','assertionResults':[{'status':'passed'}],
                                 'startTime':0,'endTime':1}]}), encoding='utf-8')
                        else:
                            (destination / 'test_case.xml').write_text('<testsuite><testcase classname="tests.test_case" time="0.1"/></testsuite>', encoding='utf-8')
                            (destination / 'progress.jsonl').write_text(json.dumps({'file':'tests/test_case.py','exit_code':3})+'\n', encoding='utf-8')
                        return 3, 'runner failed after assertions', 0.1
                    with patch('scripts.testing.runtime.command', side_effect=failed_process), patch.object(runtime, 'start_services'):
                        result, _ = runtime.execute([group], environment)
                    self.assertEqual(result['case']['status'], 'failed')
                    self.assertFalse(accepted([{'id':'case', **result['case']}], ['case']))

    def test_empty_skipped_failed_and_duplicate_results_cannot_accept_release(self):
        self.assertTrue(accepted([{'id':'one','status':'executed','tests':1}], ['one']))
        for rows, ids in [([], []), ([], ['one']), ([{'id':'one','status':'executed','tests':0}], ['one']),
                           ([{'id':'one','status':'failed','tests':1}], ['one']),
                           ([{'id':'one','status':'skipped','tests':1}], ['one']),
                           ([{'id':'one','status':'reused'}], ['one']),
                           ([{'id':'one','status':'executed','tests':1}] * 2, ['one','two'])]:
            self.assertFalse(accepted(rows, ids))

    def test_network_without_ipam_config_is_not_a_free_pool_failure(self):
        existing = ipaddress.ip_network('10.231.0.0/24')
        subnet = ipaddress.ip_network(free_subnet([{'IPAM':{'Config':None}}, {'IPAM':{'Config':[{'Subnet':str(existing)}]}}]))
        self.assertEqual(subnet.prefixlen, 28)
        self.assertFalse(subnet.overlaps(existing))
        with self.assertRaises(RuntimeError):
            free_subnet([{'IPAM':{'Config':[{'Subnet':'10.231.0.0/16'}]}}])

    def group(self, name, *, core=False, cost=10):
        return Group(name, ['tests/' + name], ['src/**'], core, cost, 'unit', ['run', name])

    def test_core_regression_failure_and_due_cannot_be_cut_by_budget(self):
        groups = [self.group('core', core=True), self.group('regression'), self.group('failed'), self.group('due')]
        history = {g.id: {'last_success': 1000, 'fingerprint': 'same'} for g in groups}
        history['failed']['failed'] = True
        history['due']['last_success'] = 0
        chosen = select(groups, [], history, {g.id: 'same' for g in groups}, now=1000, max_age=500,
                        budget=1, seed=4, regressions=['regression'])
        self.assertEqual(set(chosen), {'core', 'regression', 'failed', 'due'})
        self.assertIn('due_rotation', chosen['due'])

    def test_unknown_influence_expands_instead_of_silently_skipping(self):
        groups = [self.group('one'), self.group('two')]
        chosen = select(groups, ['new-area/unknown.py'], {}, {}, now=1000, max_age=500, budget=0, seed=2)
        self.assertTrue(all('unknown_influence' in reasons for reasons in chosen.values()))

    def test_changed_inputs_force_run_even_if_mapping_missed_them(self):
        group = self.group('one')
        chosen = select([group], [], {'one': {'last_success': 999, 'fingerprint': 'old'}}, {'one': 'new'},
                        now=1000, max_age=500, budget=0, seed=2)
        self.assertIn('inputs_changed', chosen['one'])

    def test_rotation_covers_every_group_and_replays_with_seed(self):
        groups = [self.group(str(n)) for n in range(6)]
        history = {g.id: {'last_success': 99, 'fingerprint': 'same'} for g in groups}
        inputs = {g.id: 'same' for g in groups}
        covered = set()
        for now in range(100, 106):
            chosen = select(groups, [], history, inputs, now=now, max_age=1000, budget=10, seed=42)
            self.assertEqual(chosen, select(groups, [], history, inputs, now=now, max_age=1000, budget=10, seed=42))
            covered.update(chosen)
            for key in chosen:
                history[key]['last_success'] = now
        self.assertEqual(covered, set(inputs))

    def test_reuse_needs_matching_known_inputs_unexpired_success_and_no_failure(self):
        success = {'fingerprint': 'x', 'last_success': 100, 'failed': False, 'evidence': 'run-1.json'}
        self.assertTrue(reusable(success, 'x', now=200, max_age=500))
        self.assertFalse(reusable(success, 'x', now=200, max_age=500, reasons=['unknown_influence']))
        for item, key, now in [(success, 'y', 200), (success, 'x', 601), ({**success, 'failed': True}, 'x', 200),
                               ({**success, 'evidence': None}, 'x', 200), (success, None, 200)]:
            self.assertFalse(reusable(item, key, now=now, max_age=500))

    def test_fingerprint_uses_content_and_resolved_environment_not_commit_or_mtime(self):
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as directory:
            root = Path(directory)
            (root / 'nested').mkdir()
            (root / 'nested' / 'file.py').write_text('nested')
            self.assertEqual(fingerprint(root, ['nested/**'], {'python':'same'}),
                             fingerprint(root, ['nested/**/*'], {'python':'same'}))
            (root / 'a.py').write_text('same')
            first = fingerprint(root, ['a.py'], {'python': '3.13', 'dependencies': 'one'})
            self.assertEqual(first, fingerprint(root, ['a.py'], {'python': '3.13', 'dependencies': 'one'}))
            self.assertNotEqual(first, fingerprint(root, ['a.py'], {'python': '3.14', 'dependencies': 'one'}))
            (root / 'a.py').write_text('else')
            self.assertNotEqual(first, fingerprint(root, ['a.py'], {'python': '3.13', 'dependencies': 'one'}))
            self.assertIsNone(fingerprint(root, ['missing'], {'python': '3.13'}))


if __name__ == '__main__':
    unittest.main()

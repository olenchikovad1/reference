"""Контрольные исходы TC-ADOPT-012, без Docker и рабочих данных."""
import tempfile
import unittest
from pathlib import Path
import ipaddress

from scripts.testing.policy import Group, accepted, fingerprint, select, reusable
from scripts.testing.runtime import free_subnet


class StrategyTests(unittest.TestCase):
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

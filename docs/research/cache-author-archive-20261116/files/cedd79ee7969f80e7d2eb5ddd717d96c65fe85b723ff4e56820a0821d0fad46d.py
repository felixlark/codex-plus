"""合成 unit fixtures，仅验事务顺序/失败收尾；不是实际发布/Scope验证。"""
import importlib.util
import json
from pathlib import Path
import hashlib
import os
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('p_transaction', Path(__file__).with_name('p-source-off-publication.py'))
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


class FakeError(RuntimeError):
    def __init__(self, code):
        self.code = code


class FixtureGithub:
    SWITCH_BACKUP_FAILURE = 'switch_backup_sqlite_failed'
    BACKUP_FAILURES = frozenset({SWITCH_BACKUP_FAILURE,'switch_backup_clone_failed'})
    FAILED_START_FAILURES = {'switch_candidate_start_failed'}
    @staticmethod
    def _failure_code(error):
        return getattr(error, 'code', type(error).__name__)
    @staticmethod
    def healthy(*unused):
        return False


class TransactionTests(unittest.TestCase):
    def setUp(self):
        logs = Path.home() / 'Library/Logs/me.longbiaochen.smart-shadow'
        logs.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='p-off-transaction-UNIT-FIXTURE-', dir=logs)
        self.addCleanup(self.temp.cleanup)
        self.calls = []
        self.current = 'old-fixture'
        self.target = 'new-fixture'
        self.fail_phase = None
        self.switch_error = None
        self.observe_failure = False
        self.commit_failure = False
        self.helper_failure = False
        self.known_stats = None
        self.closure_failure = False
        self.previous_verifier_failed_stats = []
        self.owner = self
        class Verifier:
            subject = p.SUBJECT
            def verify_binding(inner, **unused):
                self.calls.append('binding')
            def verify_snapshot(inner, observation, *, phase, **unused):
                self.calls.append(phase)
                if phase=='closed_previous':
                    self.previous_verifier_failed_stats.append(unused.get('failed_stats'))
                return {'p_snapshot_verified': phase != self.fail_phase,
                        'unit_fixture': True}
        self.verifier = Verifier()

    def observe(self):
        self.calls.append('observe:' + self.current)
        if self.observe_failure and self.current == 'old-fixture' and 'rollback' in self.calls:
            raise RuntimeError('fixture_stats_unavailable')
        return {'runtime': {'client_service': {'release': self.current}},
                'health': {'status': 'ok'}, 'stats': {'items': []}}

    def switch(self):
        self.calls.append('switch')
        if self.switch_error:
            raise FakeError(self.switch_error)
        self.current = self.target

    def rollback(self):
        self.calls.append('rollback')
        self.current = 'old-fixture'

    def failed_start(self):
        self.calls.append('failed-start')
        self.current = 'old-fixture'

    def close(self, role):
        self.calls.append('close:' + role)
        if self.closure_failure and role == 'candidate':
            raise RuntimeError('fixture_close_failure')
        return {'unit_fixture': True, 'role': role}

    def helper(self):
        self.calls.append('helper')
        if self.helper_failure and self.current == self.target:
            raise RuntimeError('fixture_bad_candidate_helper')

    def commit(self, payload):
        self.calls.append('commit:' + payload['status'])
        if self.commit_failure and payload['status'] == 'p_metadata_adopted':
            raise OSError('fixture_disk_error')
        dest = Path(self.temp.name) / (payload['status'] + '.json')
        raw = (json.dumps(payload, sort_keys=True) + '\n').encode()
        fd = os.open(dest, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as f:
            f.write(raw)
        return {'path': str(dest), 'sha256': hashlib.sha256(raw).hexdigest()}

    def run_tx(self):
        return p.transaction(github=FixtureGithub, verifier=self.verifier,
            switch=self.switch, rollback=self.rollback, rollback_failed_start=self.failed_start,
            observe=self.observe, close_sources=self.close, verify_helper=self.helper,
            commit=self.commit, target_release=self.target, candidate_sha='0' * 40,
            gh_config_user={'unit_fixture_only': True},
            links={'unit_fixture': True}, known_failed_stats=lambda: self.known_stats)

    def test_distinct_p_verdict_never_promotes_false_full_verdict(self):
        r = self.run_tx()
        self.assertEqual(r['status'], 'p_metadata_adopted')
        self.assertFalse(r['full_release']['generic_health_stats_passed'])
        self.assertFalse(r['full_release']['accepted'])
        self.assertNotIn('deployed', r.values())
        self.assertEqual(r['gh_config_user'], {'unit_fixture_only': True})

    def test_success_requires_source_close_then_independent_final_snapshot(self):
        self.run_tx()
        i = self.calls.index('close:candidate')
        self.assertEqual(self.calls[i+1:i+3], ['observe:new-fixture', 'closed_candidate'])

    def test_bad_candidate_p_snapshot_compensates_once(self):
        self.fail_phase = 'quiesced_candidate'
        r = self.run_tx()
        self.assertEqual(r['status'], 'p_enrollment_rolled_back')
        self.assertEqual(self.calls.count('rollback'), 1)
        self.assertEqual(r['current_release'], 'old-fixture')

    def test_closed_candidate_failure_is_inside_compensation(self):
        self.fail_phase = 'closed_candidate'
        self.assertEqual(self.run_tx()['status'], 'p_enrollment_rolled_back')
        self.assertEqual(self.calls.count('rollback'), 1)

    def test_unknown_final_stats_preserves_prior_snapshot_and_records_missing_read(self):
        original=self.observe
        known={'items':[{'source':'synthetic-known','current_failure_count':2,'historical_failure_count':19}]}
        candidate_reads=0
        def observation():
            nonlocal candidate_reads
            value=original()
            if self.current==self.target:
                candidate_reads+=1
                value['stats']=known if candidate_reads==1 else None
            return value
        self.observe=observation
        self.fail_phase='closed_candidate'
        receipt=self.run_tx()
        self.assertEqual(receipt['failed_stats'],known)
        self.assertEqual(self.previous_verifier_failed_stats,[known])
        self.assertEqual(receipt['candidate_stats_unavailable_phases'],['closed_candidate'])
        self.assertEqual(self.calls.count('rollback'),1)

    def test_bad_new_helper_does_not_block_old_recovery_verification(self):
        self.helper_failure = True
        self.assertEqual(self.run_tx()['status'], 'p_enrollment_rolled_back')
        self.assertNotIn('helper', self.calls[self.calls.index('rollback'):])
        self.assertNotIn('binding', self.calls[self.calls.index('rollback'):])

    def test_backup_failure_never_calls_lifecycle_recovery(self):
        self.switch_error = 'switch_backup_sqlite_failed'
        r = self.run_tx()
        self.assertEqual(r['rollback_path'], 'switch_backup_sqlite_failed')
        self.assertNotIn('rollback', self.calls)
        self.assertNotIn('failed-start', self.calls)
        self.assertIsNone(r['failed_stats'])

    def test_failed_start_calls_only_dedicated_once(self):
        self.switch_error = 'switch_candidate_start_failed'
        r = self.run_tx()
        self.assertEqual(r['rollback_path'], 'rollback-failed-start')
        self.assertEqual(self.calls.count('failed-start'), 1)
        self.assertNotIn('rollback', self.calls)

    def test_clone_backup_failure_preserves_real_code_and_never_repeats_lifecycle(self):
        self.switch_error = 'switch_backup_clone_failed'
        receipt = self.run_tx()
        self.assertEqual(receipt['rollback_path'],'switch_backup_clone_failed')
        self.assertNotIn('rollback',self.calls)
        self.assertNotIn('failed-start',self.calls)
        self.assertEqual(self.calls.count('switch'),1)
        self.assertIsNone(receipt['failed_stats'])

    def test_receipt_write_failure_compensates_real_candidate(self):
        self.commit_failure = True
        self.assertEqual(self.run_tx()['status'], 'p_enrollment_rolled_back')
        self.assertEqual(self.calls.count('rollback'), 1)

    def test_rollback_stats_unknown_still_closes_original_sources(self):
        self.fail_phase = 'quiesced_candidate'
        self.observe_failure = True
        with self.assertRaises(p.PTransactionFailure) as got:
            self.run_tx()
        self.assertIn('close:previous', self.calls)
        self.assertIsNone(got.exception.evidence['rollback_stats'])
        self.assertEqual(self.calls.count('rollback'), 1)

    def test_preflight_failure_does_not_switch(self):
        self.fail_phase = 'quiesced_previous'
        with self.assertRaises(p.PTransactionFailure):
            self.run_tx()
        self.assertNotIn('switch', self.calls)

    def test_known_internal_candidate_stats_are_not_falsely_null(self):
        self.switch_error = 'fixture_internal_acceptance_failed'
        self.known_stats = {'items': [{'source': 'fixture', 'historical_failure_count': 1}]}
        self.assertEqual(self.run_tx()['failed_stats'], self.known_stats)

    def test_candidate_source_close_failure_rolls_back_and_closes_previous(self):
        self.closure_failure = True
        self.assertEqual(self.run_tx()['status'], 'p_enrollment_rolled_back')
        self.assertIn('close:previous', self.calls)
        self.assertEqual(self.calls.count('rollback'), 1)

    def test_bad_previous_snapshot_never_issues_verified_rollback(self):
        self.fail_phase = 'closed_previous'
        self.switch_error = 'fixture_failure'
        with self.assertRaises(p.PTransactionFailure):
            self.run_tx()
        self.assertFalse(any(x.startswith('commit:') for x in self.calls))

    def test_rollback_exception_is_not_retried(self):
        self.switch_error = 'fixture_failure'
        def bad_rollback():
            self.calls.append('bad-rollback')
            raise RuntimeError('fixture_unknown')
        self.rollback = bad_rollback
        with self.assertRaises(p.PTransactionFailure):
            self.run_tx()
        self.assertEqual(self.calls.count('bad-rollback'), 1)

    def test_previous_stats_are_never_mislabeled_failed_candidate_stats(self):
        self.switch = lambda: self.calls.append('switch-without-target')
        r = self.run_tx()
        self.assertEqual(r['status'], 'p_enrollment_rolled_back')
        self.assertIsNone(r['failed_stats'])

    def test_keyboard_interrupt_after_switch_is_safely_compensated_once(self):
        def interrupted_switch():
            self.current = self.target
            raise KeyboardInterrupt()
        self.switch = interrupted_switch
        r = self.run_tx()
        self.assertEqual(r['status'], 'p_enrollment_rolled_back')
        self.assertEqual(self.calls.count('rollback'), 1)

    def test_baseline_bad_health_cannot_be_overridden_by_verifier(self):
        original = self.observe
        def unhealthy():
            x = original();x['health']['status'] = 'error';return x
        self.observe = unhealthy
        with self.assertRaises(p.PTransactionFailure):
            self.run_tx()
        self.assertNotIn('switch', self.calls)

    def test_known_wrong_release_refuses_previous_source_close(self):
        self.fail_phase = 'quiesced_candidate'
        self.rollback = lambda: self.calls.append('rollback-without-restoration')
        with self.assertRaises(p.PTransactionFailure):
            self.run_tx()
        self.assertNotIn('close:previous', self.calls)

    def test_known_wrong_release_with_missing_stats_still_refuses_close(self):
        self.fail_phase = 'quiesced_candidate'
        self.rollback = lambda: self.calls.append('rollback-without-restoration')
        original = self.observe
        def missing_stats_after_failed_rollback():
            x = original()
            if 'rollback-without-restoration' in self.calls:x.pop('stats')
            return x
        self.observe = missing_stats_after_failed_rollback
        with self.assertRaises(p.PTransactionFailure):
            self.run_tx()
        self.assertNotIn('close:previous', self.calls)


if __name__ == '__main__':
    unittest.main()

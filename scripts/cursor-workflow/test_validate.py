"""Exercise false-success rejection with isolated synthetic delivery records."""
import copy
import hashlib
import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location('cursor_workflow_validate', Path(__file__).with_name('validate.py'))
VALIDATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VALIDATOR)


class EvidenceGateTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.base = Path(self.directory.name)
        log = self.base / 'test.log'
        log.write_text('node --test priority.test.mjs\n# pass 12\n# fail 0\n# skipped 0\n')
        proof = [{'path': 'test.log', 'sha256': hashlib.sha256(log.read_bytes()).hexdigest()}]
        head = subprocess.check_output(['git', '-C', str(VALIDATOR.ROOT), 'rev-parse', 'HEAD'], text=True).strip()
        self.data = {
            'schema_version': 1, 'task_id': 'synthetic-gate-test', 'scope': 'trial', 'state': 'complete',
            'head_sha': head, 'blockers': [],
            'stages': {name: {'status': 'passed', 'summary': 'synthetic evidence fixture',
                              'evidence': copy.deepcopy(proof)} for name in VALIDATOR.STAGES},
            'checks': [{'id': 'C1', 'command': 'node --test priority.test.mjs', 'head_sha': head,
                        'exit_code': 0, 'status': 'passed', 'evidence': copy.deepcopy(proof)}],
            'acceptance': [{'id': 'AC1', 'description': 'synthetic behavior', 'check_ids': ['C1']}],
            'review': {'author_actor': 'author-session', 'reviewer_actor': 'review-session',
                       'head_sha': head, 'status': 'passed', 'open_blockers': [],
                       'evidence': copy.deepcopy(proof)},
            'delivery': {'status': 'ready', 'summary': 'synthetic local handoff',
                         'production_deployed': False, 'evidence': copy.deepcopy(proof)},
        }

    def run_gate(self):
        path = self.base / 'task.json'
        path.write_text(json.dumps(self.data))
        return VALIDATOR.task(path)

    def test_structurally_complete_synthetic_record_passes(self):
        self.assertEqual(self.run_gate()['checks'], 1)

    def test_nonzero_exit_is_rejected(self):
        self.data['checks'][0]['exit_code'] = 1
        with self.assertRaisesRegex(ValueError, 'failed/skipped'):
            self.run_gate()

    def test_skip_output_is_rejected_even_with_zero_exit(self):
        log = self.base / 'test.log'
        log.write_text('SKIP: browser tests are not implemented\n')
        digest = hashlib.sha256(log.read_bytes()).hexdigest()
        for stage in self.data['stages'].values():
            stage['evidence'][0]['sha256'] = digest
        self.data['checks'][0]['evidence'][0]['sha256'] = digest
        with self.assertRaisesRegex(ValueError, 'SKIP log'):
            self.run_gate()

    def test_stale_commit_is_rejected(self):
        self.data['checks'][0]['head_sha'] = '0' * 40
        with self.assertRaisesRegex(ValueError, 'stale check'):
            self.run_gate()

    def test_self_review_is_rejected(self):
        self.data['review']['reviewer_actor'] = self.data['review']['author_actor']
        with self.assertRaisesRegex(ValueError, 'own work'):
            self.run_gate()

    def test_modified_evidence_is_rejected(self):
        (self.base / 'test.log').write_text('changed after review\n')
        with self.assertRaisesRegex(ValueError, 'digest mismatch'):
            self.run_gate()

    def test_uncovered_acceptance_is_rejected(self):
        self.data['acceptance'][0]['check_ids'] = ['missing-check']
        with self.assertRaisesRegex(ValueError, 'no matching'):
            self.run_gate()

    def test_evidence_cannot_follow_symlink_outside_task(self):
        outside = tempfile.NamedTemporaryFile(delete=False)
        outside.close()
        self.addCleanup(Path(outside.name).unlink)
        (self.base / 'escape.log').symlink_to(outside.name)
        self.data['stages']['requirements']['evidence'][0]['path'] = 'escape.log'
        with self.assertRaisesRegex(ValueError, 'escaped task'):
            self.run_gate()

    def test_open_review_blocker_is_rejected(self):
        self.data['review']['open_blockers'] = ['cross-tenant data exposure']
        with self.assertRaisesRegex(ValueError, 'review has blockers'):
            self.run_gate()

    def test_template_is_not_a_completed_delivery(self):
        self.data['state'] = 'in_progress'
        with self.assertRaisesRegex(ValueError, 'not marked complete'):
            self.run_gate()


if __name__ == '__main__':
    unittest.main()

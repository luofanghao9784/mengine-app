import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
import uuid

spec = importlib.util.spec_from_file_location('verify', Path(__file__).with_name('verify-source-rule-drafts.py'))
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False))
    path.chmod(0o600)


class DraftBindingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        identifier, snapshot = str(uuid.uuid4()), str(uuid.uuid4())
        self.definition = {'id': identifier, 'name': '合成表', 'source': 'synthetic', 'scope': '合成范围',
                           'columns': [{'name': '编号', 'source': '编号', 'type': 'text'}],
                           'primaryKey': ['编号'], 'headerRow': 1, 'sheet': None}
        db = sqlite3.connect(self.root / 'state.sqlite')
        db.execute('CREATE TABLE datasets(id,definition,snapshot,last_error)')
        db.execute('INSERT INTO datasets VALUES(?,?,?,NULL)', (identifier, json.dumps(self.definition), snapshot))
        db.commit(); db.close()
        (self.root / 'packages').mkdir(mode=0o700)
        self.package_path = self.root / 'packages' / (snapshot + '.json')
        schema = {k: v for k, v in self.definition.items() if k != 'id'}
        index = {'["0001"]': verify.digest(['0001'])}
        package = {'datasetId': identifier, 'columns': ['编号'], 'rows': [['0001']],
                   'contentHash': verify.digest({'schema': schema, 'index': index})}
        write(self.package_path, package)
        self.directory = self.root / 'source-research' / identifier
        self.directory.mkdir(parents=True, mode=0o700)
        self.draft = {'format': 'source-rule-draft-v1', 'datasetId': identifier, 'source': 'synthetic',
                      'scopeHash': verify.digest('合成范围'), 'columns': ['编号'],
                      'fields': [{'column': '编号', 'status': 'UNKNOWN'}], 'rules': [], 'approved': False}
        draft_id = verify.digest(self.draft)
        write(self.directory / (draft_id + '.json'), self.draft)
        self.receipt = {'draftId': draft_id, 'snapshotHash': package['contentHash'], 'rowCount': 1,
                        'approved': False, 'publishedToDreamcore': False, 'checks': [], 'rulesChecked': 0,
                        'state': 'NEEDS_EVIDENCE', 'documentedFields': 0, 'unknownFields': 1, 'failedRules': 0}
        write(self.directory / 'latest.json', self.receipt)
        self.binding = {'tenantId': str(uuid.uuid4()), 'connectionId': str(uuid.uuid4()), 'home': str(self.root),
                        'datasets': [{'id': str(uuid.uuid4()), 'localDatasetId': identifier,
                                      'source': 'synthetic', 'scope': '合成范围', 'columns': ['编号']}]}

    def tearDown(self):
        self.temp.cleanup()

    def test_aligned_draft_remains_unapproved(self):
        result = verify.verify(self.binding)['tables'][0]
        self.assertTrue(result['draftBindingVerified'])
        self.assertFalse(result['businessApproved'])

    def test_changed_scope_rejected(self):
        self.binding['datasets'][0]['scope'] = '其他范围'
        with self.assertRaisesRegex(ValueError, 'SOURCE_BINDING_MISMATCH'):
            verify.verify(self.binding)

    def test_stale_snapshot_and_claimed_approval_rejected(self):
        self.receipt['snapshotHash'] = 'stale'
        write(self.directory / 'latest.json', self.receipt)
        with self.assertRaisesRegex(ValueError, 'DRAFT_SNAPSHOT_MISMATCH'):
            verify.verify(self.binding)
        self.receipt['snapshotHash'] = json.loads(self.package_path.read_text())['contentHash']
        self.receipt['approved'] = True
        write(self.directory / 'latest.json', self.receipt)
        with self.assertRaisesRegex(ValueError, 'DRAFT_CANNOT_GRANT_APPROVAL'):
            verify.verify(self.binding)

    def test_modified_rows_cannot_reuse_snapshot_hash(self):
        package = json.loads(self.package_path.read_text())
        package['rows'] = [['0002']]
        write(self.package_path, package)
        with self.assertRaisesRegex(ValueError, 'SOURCE_PACKAGE_HASH_MISMATCH'):
            verify.verify(self.binding)


if __name__ == '__main__':
    unittest.main()

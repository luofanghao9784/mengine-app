import fcntl
import hashlib
import hmac
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts/local'))
import backup
import trial


class BackupBoundaryTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.key = self.root / 'keys' / 'signing.json'
        self.secret = backup.signing_key(self.key, True)
        self.bundle = backup.reserve(self.root / 'bundle')
        (self.bundle / 'objects').mkdir(mode=0o700)
        self.dump = self.bundle / 'database.dump'
        self.dump.write_bytes(b'synthetic archive, never executed')
        self.dump.chmod(0o600)
        self.manifest = {'format': backup.FORMAT, 'postgresMajor': 18,
                         'schemaHash': backup.schema_hash(), 'tables': {},
                         'files': {'database.dump': backup.digest(self.dump)}}
        self.sign()

    def sign(self):
        trial.private_write(self.bundle / 'manifest.json', {'manifest': self.manifest,
            'signature': hmac.new(self.secret, backup.canonical(self.manifest), hashlib.sha256).hexdigest()})

    def rejected(self):
        with self.assertRaises(trial.TrialError):
            backup.verify(self.bundle, self.key)

    def test_verified_bundle_and_key_are_private_and_separate(self):
        self.assertEqual(backup.verify(self.bundle, self.key), self.manifest)
        self.assertEqual(self.key.stat().st_mode & 0o777, 0o600)
        with self.assertRaises(trial.TrialError):
            backup.verify(self.bundle, self.bundle / 'key.json')

    def test_changed_database_is_rejected_before_starting_postgres(self):
        self.dump.write_bytes(b'changed')
        with patch.object(backup, 'offline_database') as db:
            with self.assertRaises(trial.TrialError):
                backup.restore(self.bundle, self.root / 'restored', self.key)
            db.assert_not_called()
        self.assertFalse((self.root / 'restored').exists())

    def test_changed_manifest_and_foreign_key_are_rejected(self):
        signed = trial.private_read(self.bundle / 'manifest.json')
        signed['manifest']['tables'] = {'accounts': {'rows': 0}}
        trial.private_write(self.bundle / 'manifest.json', signed)
        self.rejected()
        self.sign()
        wrong_key = self.root / 'different-key.json'
        backup.signing_key(wrong_key, True)
        with self.assertRaises(trial.TrialError):
            backup.verify(self.bundle, wrong_key)

    def test_missing_extra_and_symlink_files_are_rejected(self):
        self.dump.rename(self.bundle / 'extra')
        self.rejected()
        (self.bundle / 'extra').rename(self.dump)
        extra = self.bundle / 'objects' / 'extra'
        extra.write_bytes(b'not allowed')
        self.rejected()
        extra.unlink()
        target = self.root / 'untouched'
        self.dump.rename(target)
        self.dump.symlink_to(target)
        self.rejected()
        self.assertEqual(target.read_bytes(), b'synthetic archive, never executed')

    def test_signed_path_traversal_size_and_permissions_are_rejected(self):
        self.manifest['files']['../outside'] = {'bytes': 0, 'sha256': '0' * 64}
        self.sign()
        self.rejected()
        del self.manifest['files']['../outside']
        self.manifest['files']['database.dump']['bytes'] = backup.MAX_BYTES + 1
        self.sign()
        self.rejected()
        self.manifest['files']['database.dump'] = backup.digest(self.dump)
        self.sign()
        self.dump.chmod(0o644)
        self.rejected()

    def test_restore_refuses_existing_or_nested_target_and_schema_mismatch(self):
        target = self.root / 'existing'
        target.mkdir(mode=0o700)
        marker = target / 'keep'
        marker.write_text('keep')
        for output in [target, self.bundle / 'nested']:
            with self.assertRaises(trial.TrialError):
                backup.restore(self.bundle, output, self.key)
        self.assertEqual(marker.read_text(), 'keep')
        self.manifest['schemaHash'] = 'another-schema'
        self.sign()
        with self.assertRaises(trial.TrialError):
            backup.restore(self.bundle, self.root / 'new', self.key)
        self.assertFalse((self.root / 'new').exists())

    def test_running_trial_lock_prevents_backup_without_stopping_it(self):
        source = backup.reserve(self.root / 'source')
        trial.private_write(source / 'config.json', {'format': trial.FORMAT, 'workspace': str(trial.WORKSPACE),
            'ports': {'database': 20001, 'api': 20002, 'web': 20003}})
        with (source / 'supervisor.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(trial.TrialError):
                backup.create(source, self.root / 'new-bundle', self.key)
            self.assertFalse((source / 'stop-request.json').exists())
            self.assertFalse((self.root / 'new-bundle').exists())

    def test_failed_restore_never_publishes_startable_config(self):
        target = self.root / 'new'
        with patch.object(backup, 'offline_database', side_effect=trial.TrialError('synthetic failure')):
            with self.assertRaises(trial.TrialError):
                backup.restore(self.bundle, target, self.key)
        self.assertFalse(target.exists())

    def test_copy_race_is_detected_before_postgres(self):
        original = backup.shutil.copyfile
        def change_copy(source, target):
            original(source, target)
            Path(target).write_bytes(b'changed during read')
        with patch.object(backup.shutil, 'copyfile', side_effect=change_copy), patch.object(backup, 'offline_database') as db:
            with self.assertRaises(trial.TrialError):
                backup.restore(self.bundle, self.root / 'new', self.key)
            db.assert_not_called()

    def test_failed_stop_preserves_potentially_running_database(self):
        from contextlib import contextmanager
        target = self.root / 'new'
        @contextmanager
        def failed_stop(root, initialize=False):
            (root / 'postgres').mkdir()
            (root / 'postgres' / 'postmaster.pid').write_text('synthetic-not-running')
            raise trial.TrialError('synthetic stop failure')
            yield
        with patch.object(backup, 'offline_database', failed_stop):
            with self.assertRaises(trial.TrialError):
                backup.restore(self.bundle, target, self.key)
        self.assertTrue((target / 'postgres' / 'postmaster.pid').exists())
        self.assertFalse((target / 'config.json').exists())

    def test_queued_work_or_incompatible_schema_prevents_snapshot(self):
        versions = ','.join(map(str, range(1, 16)))
        for schema, active in [(versions, '1'), (versions + ',16', '0')]:
            def sql(query):
                if 'flyway_schema_history' in query:
                    return schema
                if 'conversation_tasks' in query:
                    return active
                self.fail('A rejected snapshot must not read business tables')
            with self.assertRaises(trial.TrialError):
                backup.facts(sql)

    def test_other_worktree_source_is_rejected_before_database_access(self):
        source = backup.reserve(self.root / 'foreign')
        trial.private_write(source / 'config.json', {'format': trial.FORMAT, 'workspace': '/another/worktree'})
        with patch.object(backup, 'offline_database') as db:
            with self.assertRaises(trial.TrialError):
                backup.create(source, self.root / 'new-bundle', self.key)
            db.assert_not_called()
        self.assertFalse((self.root / 'new-bundle').exists())

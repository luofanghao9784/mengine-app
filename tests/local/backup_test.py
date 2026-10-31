from datetime import timedelta
import uuid
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
import backup_recovery
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
                         'snapshotId': str(uuid.uuid4()), 'sourceInstanceId': str(uuid.uuid4()),
                         'createdAt': backup.now().isoformat(),
                         'schemaHash': backup.schema_hash(), 'tables': {}, 'migrations':backup.migrations(), 'sourceTransaction':1,
                         'files': {'database.dump': backup.digest(self.dump)}}
        self.manifest['expiresAt'] = (backup.datetime.fromisoformat(self.manifest['createdAt']) + timedelta(days=30)).isoformat()
        self.sign()

    def test_cli_verify_writes_projected_success_without_changing_command_result(self):
        import subprocess
        status = self.root / 'status.json'
        result = subprocess.run([sys.executable, str(Path(backup.__file__)), 'verify', '--bundle', str(self.bundle), '--key-file', str(self.key), '--status-file', str(status)], capture_output=True, text=True)
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual({'status':'verified','files':1,'tables':0}, json.loads(result.stdout))
        event = json.loads(status.read_text())['events'][0]
        self.assertEqual(('VERIFY','SUCCEEDED'), (event['command'], event['state']))
        self.assertEqual(self.manifest['snapshotId'], event['snapshot']['id'])
        self.assertNotIn(str(self.bundle), status.read_text())
        self.dump.write_bytes(b'corrupt')
        result = subprocess.run([sys.executable, str(Path(backup.__file__)), 'verify', '--bundle', str(self.bundle), '--key-file', str(self.key), '--status-file', str(status)], capture_output=True, text=True)
        self.assertEqual(1, result.returncode)
        self.assertEqual('FAILED', json.loads(status.read_text())['events'][0]['state'])

    def sign(self):
        trial.private_write(self.bundle / 'manifest.json', {'manifest': self.manifest,
            'signature': hmac.new(self.secret, backup.canonical(self.manifest), hashlib.sha256).hexdigest()})

    def rejected(self):
        with self.assertRaises(trial.TrialError):
            backup.verify(self.bundle, self.key)

    def test_same_schema_new_cleanup_cannot_silently_reuse_adapter(self):
        with patch.object(backup_recovery,'implementation_hashes',return_value={'changed-cleanup':'different'}):
            with self.assertRaisesRegex(trial.TrialError,'清理实现'):
                backup_recovery.coverage(lambda _:self.fail('drift must fail before database reads'))

    def test_stale_runtime_cannot_open_new_recovery_schema(self):
        import zipfile
        workspace=self.root/'build-fixture';migrations=workspace/'apps/api/src/main/resources/db/migration'
        migrations.mkdir(parents=True);(migrations/'V1__guard.sql').write_text('SELECT 1;')
        common=migrations.parent/'migration-common';common.mkdir();(common/'V149__common.sql').write_text('SELECT 149;')
        jar=workspace/'api.jar'
        def write(entries):
            with zipfile.ZipFile(jar,'w') as archive:
                for name,body in entries.items():archive.writestr('BOOT-INF/classes/db/migration/'+name,body)
                archive.writestr('BOOT-INF/classes/db/migration-common/V149__common.sql','SELECT 149;')
        with patch.object(trial,'WORKSPACE',workspace):
            write({'V1__guard.sql':'SELECT 1;'});trial.verify_api_migrations(jar)
            for entries in [{},{'V1__guard.sql':'SELECT 2;'},{'V1__guard.sql':'SELECT 1;','V2__unknown.sql':'SELECT 1;'}]:
                write(entries)
                with self.assertRaises(trial.TrialError):trial.verify_api_migrations(jar)
            write({'V1__guard.sql':'SELECT 1;'});(migrations/'V2__departure_guard.sql').write_text('SELECT 2;')
            with self.assertRaises(trial.TrialError):trial.verify_api_migrations(jar)

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

    def test_incompatible_schema_prevents_snapshot(self):
        for actual in [[], [{'version': '1', 'script': 'V1__wrong.sql', 'success': True}]]:
            def sql(query):
                if 'flyway_schema_history' in query:
                    return json.dumps(actual)
                self.fail('A rejected snapshot must not read business tables')
            with self.assertRaises(trial.TrialError):
                backup.facts(sql)

    def test_expiry_uses_signed_snapshot_time_not_file_timestamp(self):
        created = backup.datetime.fromisoformat(self.manifest['createdAt'])
        with patch.object(backup, 'now', return_value=created + timedelta(days=30)):
            with self.assertRaises(trial.TrialError):
                backup.restore(self.bundle, self.root / 'expired', self.key)
        self.assertFalse((self.root / 'expired').exists())
        self.manifest['expiresAt'] = (created + timedelta(days=31)).isoformat()
        self.sign()
        self.rejected()

    def test_repack_preserves_identity_and_original_expiry(self):
        copy = self.root / 'copy'
        result = backup.repack(self.bundle, copy, self.key)
        self.assertEqual(backup.verify(copy, self.key), self.manifest)
        self.assertEqual(result['expiresAt'], self.manifest['expiresAt'])
        with patch.object(backup, 'now', return_value=backup.datetime.fromisoformat(self.manifest['expiresAt'])):
            with self.assertRaises(trial.TrialError):
                backup.repack(copy, self.root / 'renewed', self.key)

    def test_rotation_only_removes_verified_expired_bundles(self):
        collection = backup.reserve(self.root / 'collection')
        backup.repack(self.bundle, collection / 'expired', self.key)
        unknown = collection / 'unknown'
        unknown.mkdir(mode=0o700)
        (unknown / 'keep').write_text('keep')
        with patch.object(backup, 'now', return_value=backup.datetime.fromisoformat(self.manifest['expiresAt'])):
            result = backup.rotate(collection, self.key)
        self.assertEqual(result['removed'], ['expired'])
        self.assertEqual(result['rejected'], ['unknown'])
        self.assertTrue((unknown / 'keep').exists())

    def test_restore_marker_always_blocks_application_start(self):
        root = backup.reserve(self.root / 'restored')
        trial.private_write(root / 'restore.json', {'state': 'CURRENT_STATE_CHECKED_QUARANTINED'})
        with self.assertRaisesRegex(trial.TrialError, '隔离恢复'):
            trial.start(root)

    def test_other_worktree_source_is_rejected_before_database_access(self):
        source = backup.reserve(self.root / 'foreign')
        trial.private_write(source / 'config.json', {'format': trial.FORMAT, 'workspace': '/another/worktree'})
        with patch.object(backup, 'offline_database') as db:
            with self.assertRaises(trial.TrialError):
                backup.create(source, self.root / 'new-bundle', self.key)
            db.assert_not_called()
        self.assertFalse((self.root / 'new-bundle').exists())

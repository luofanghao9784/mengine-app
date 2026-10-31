"""Default migration lineage and archive guards; synthetic PG18 test is explicit opt-in."""
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import warnings
import zipfile
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts/local'))
import trial
import backup
import backup_recovery

class MigrationManifestTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.db = self.root / 'apps/api/src/main/resources/db'
        for name in ('migration', 'migration-common', 'migration-local'):
            (self.db / name).mkdir(parents=True)
        (self.db/'migration/V1__first.sql').write_text('SELECT 1;')
        (self.db/'migration-common/V149__common.sql').write_text('SELECT 149;')
        (self.db/'migration-local/V2__other.sql').write_text('SELECT 2;')
        patcher = patch.object(trial, 'WORKSPACE', self.root)
        patcher.start(); self.addCleanup(patcher.stop)

    def history(self):
        return [dict(m, success=True) for m in ({'version': '1', 'script': 'V1__first.sql'},
                    {'version': '149', 'script': 'V149__common.sql'})]

    def test_default_history_and_manifest_include_common_only(self):
        self.assertEqual(['1','149'], [m['version'] for m in backup.migrations()])
        backup.check_migrations(lambda _: json.dumps(self.history()))

    def test_history_mismatches_remain_rejected(self):
        rows = self.history()
        cases = [rows[:1], rows+[{'version':'200','script':'V200__extra.sql','success':True}],
                 [dict(rows[0],script='wrong.sql'), rows[1]],
                 [rows[0],dict(rows[1],success=False)], list(reversed(rows)),
                 [dict(rows[0],version='2',script='V2__other.sql'),rows[1]]]
        for history in cases:
            with self.subTest(history=history), self.assertRaises(trial.TrialError):
                backup.check_migrations(lambda _:json.dumps(history))

    def test_common_bytes_change_schema_hash(self):
        before=backup.schema_hash()
        (self.db/'migration-common/V149__common.sql').write_text('SELECT 150;')
        self.assertNotEqual(before,backup.schema_hash())

    def test_duplicate_version_is_rejected(self):
        (self.db/'migration-common/V1__duplicate.sql').write_text('SELECT 1;')
        with self.assertRaises(trial.TrialError): backup.migrations()

    def test_missing_directory_is_rejected(self):
        (self.db/'migration-common/V149__common.sql').unlink()
        with self.assertRaises(trial.TrialError): backup.migrations()

    def jar(self, changes=None, duplicate=False):
        target=self.root/'runtime.jar'
        with warnings.catch_warnings():
            warnings.simplefilter('ignore',UserWarning)
            with zipfile.ZipFile(target,'w') as archive:
                for path in trial.api_migration_files():
                    name='BOOT-INF/classes/db/'+str(path.relative_to(self.db))
                    if changes=='missing' and 'migration-common' in name:continue
                    content=path.read_bytes()
                    if changes=='stale' and 'migration-common' in name:content=b'SELECT 0;'
                    archive.writestr(name,content)
                    if duplicate and 'migration-common' in name:archive.writestr(name,content)
                if changes=='extra':archive.writestr('BOOT-INF/classes/db/migration-common/V200__extra.sql','SELECT 200;')
        return target

    def test_complete_jar_passes(self):trial.verify_api_migrations(self.jar())

    def test_incomplete_stale_extra_duplicate_jar_rejected(self):
        for change in ['missing','stale','extra','duplicate']:
            with self.subTest(change=change),self.assertRaises(trial.TrialError):
                trial.verify_api_migrations(self.jar(None if change=='duplicate' else change,change=='duplicate'))

@unittest.skipUnless(os.environ.get('RUN_BACKUP_DB_TESTS')=='1','explicit synthetic PG18 opt-in')
class ActualMigrationBackupTest(unittest.TestCase):
    def test_default_schema_backup_and_fail_closed_restore(self):
        with tempfile.TemporaryDirectory(prefix='backup-migrations-synthetic-') as folder:
            root=Path(folder); source=backup.reserve(root/'source'); key=root/'keys/signing.json'
            trial.private_write(source/'config.json',{'format':trial.FORMAT,'workspace':str(trial.WORKSPACE),'ports':{'database':22001,'api':22002,'web':22003}})
            import secrets
            trial.private_write(source/'database.json',{'password':secrets.token_urlsafe(32)})
            with backup.offline_database(source,True) as (run,args,sql):
                sql('CREATE TABLE flyway_schema_history(installed_rank integer PRIMARY KEY,version varchar(50),script varchar(1000),success boolean)')
                files=trial.api_migration_files()
                for rank,path in enumerate(files,1):
                    run([backup.pg('psql'),'-X',*args,'-v','ON_ERROR_STOP=1','-1','-f',str(path)])
                    version=path.name.split('__')[0][1:]
                    sql(f"INSERT INTO flyway_schema_history VALUES({rank},'{version}','{path.name}',true)")
                backup.check_migrations(sql)
                # Exact old enumeration is demonstrably short of this actual synthetic history.
                old=[m for m in backup.migrations() if int(m['version'])<149]
                with patch.object(backup,'migrations',return_value=old),self.assertRaises(trial.TrialError):backup.check_migrations(sql)
                with self.assertRaises(trial.TrialError):backup_recovery.coverage(sql)
                print('SYNTHETIC_HISTORY default='+str(len(files))+' old_expected='+str(len(old))+' common='+str(len(files)-len(old)))
            result=backup.create(source,root/'bundle',key)
            self.assertEqual('created',result['status'])
            manifest=backup.verify(root/'bundle',key)
            self.assertEqual(len(files),len(manifest['migrations']))
            with self.assertRaises(trial.TrialError):backup.restore(root/'bundle',root/'restored',key)
            print('SYNTHETIC_BACKUP created+verified; restore rejected by existing gate (not recoverability approval)')
            with backup.offline_database(source) as (_,__,sql):sql('UPDATE flyway_schema_history SET success=false WHERE installed_rank=1')
            with self.assertRaises(trial.TrialError):backup.create(source,root/'bad-bundle',key)
            self.assertFalse((root/'bad-bundle').exists())
            print('SYNTHETIC_NEGATIVE failed_history rejected; no completed bundle')

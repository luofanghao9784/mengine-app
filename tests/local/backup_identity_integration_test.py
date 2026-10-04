"""Identity adapter component tests on synthetic PostgreSQL 18, NOT full recovery certification.

The raw dump is restored into an offline fixture with no trial configuration/activation marker.
Production coverage is never mocked or regenerated. Run with RUN_BACKUP_DB_TESTS=1.
"""
import contextlib
import hashlib
import json
import os
import unittest
import uuid

import backup_integration_test as fixture

backup, recovery, trial = fixture.backup, fixture.backup_recovery, fixture.trial
ident = fixture.ident


@unittest.skipUnless(os.environ.get('RUN_BACKUP_DB_TESTS') == '1', 'explicit synthetic PostgreSQL test opt-in')
class BackupIdentityAdapterTest(unittest.TestCase):
    setUp = fixture.RealBackupTest.setUp
    seed = fixture.RealBackupTest.seed
    seed_current_modules = fixture.RealBackupTest.seed_current_modules

    def seed_platform(self, numbers=(501, 502)):
        with backup.offline_database(self.source) as (_, __, sql):
            for n in numbers:
                sql(f"""INSERT INTO accounts(id,email,display_name,password_hash)
                  VALUES('{ident(n)}','audit-{n}@example.invalid','Synthetic operations','!PLATFORM_ONLY!');
                INSERT INTO platform_accounts(account_id,login_name,password_hash,credential_version,management_version)
                  VALUES('{ident(n)}','operator-{n}@example.invalid','old-platform-hash',7,11);
                INSERT INTO platform_roles VALUES('{ident(n)}','PLATFORM_ADMIN');
                INSERT INTO platform_sessions(token_hash,csrf_hash,account_id,credential_version,expires_at)
                  VALUES('{n:064x}','{n+100:064x}','{ident(n)}',7,now()+interval '1 hour');""")
            sql(f"""INSERT INTO platform_sessions(token_hash,csrf_hash,expires_at)
              VALUES('{'a'*64}','{'b'*64}',now()+interval '1 hour');
            INSERT INTO platform_staff_invitations(id,login_name,token_hash,invited_by,expires_at)
              VALUES('{ident(551)}','pending@example.invalid','{'c'*64}','{ident(numbers[0])}',now()+interval '1 day');
            INSERT INTO platform_staff_invitations(id,login_name,token_hash,invited_by,status,accepted_by,expires_at)
              VALUES('{ident(552)}','accepted@example.invalid','{'d'*64}','{ident(numbers[0])}','ACCEPTED','{ident(numbers[0])}',now()+interval '1 day');""")

    def snapshot(self):
        bundle = self.root / ('bundle-' + str(uuid.uuid4()))
        backup.create(self.source, bundle, self.key)
        return bundle

    @contextlib.contextmanager
    def offline_copy(self, bundle):
        # No config.json, restore.json or HTTP process: this is only an adapter test fixture.
        root = backup.reserve(self.root / ('adapter-' + str(uuid.uuid4())))
        trial.private_write(root / 'database.json', {'password': 'synthetic-' + str(uuid.uuid4())})
        with backup.offline_database(root, True) as (run, args, sql):
            run([backup.pg('pg_restore'), *args, '--no-owner', '--no-acl', '--single-transaction',
                 '--exit-on-error', str(bundle / 'database.dump')])
            self.assertEqual(backup.facts(sql), backup.verify(bundle, self.key)['tables'])
            yield root, sql
        self.assertFalse((root / 'config.json').exists())
        self.assertFalse((root / 'restore.json').exists())

    def password_matches(self, password, encoded):
        self.assertTrue(encoded.startswith('{pbkdf2-sha256-v1}'))
        packed = bytes.fromhex(encoded.split('}', 1)[1])
        return hashlib.pbkdf2_hmac('sha256', password.encode(), packed[:16], 600_000, 32) == packed[16:]

    def test_dump_omits_both_platform_session_kinds_and_quarantine_revokes_credentials(self):
        self.seed_platform()
        bundle = self.snapshot()
        self.assertNotIn('platform_sessions', backup.verify(bundle, self.key)['tables'])
        with backup.offline_database(self.source) as (_, __, sql):
            self.assertEqual(sql('SELECT count(*) FROM platform_sessions'), '3')
        with self.offline_copy(bundle) as (root, sql):
            self.assertEqual(sql('SELECT count(*) FROM platform_sessions'), '0')
            # The actual complete-recovery gate must still reject the unreviewed schema.
            with self.assertRaisesRegex(trial.TrialError, '保持隔离'):
                recovery.coverage(sql)
            recovery.quarantine(sql)
            self.assertEqual(sql("SELECT count(*) FROM platform_accounts WHERE password_hash='!RECOVERY_DISABLED!' AND credential_version=8"), '2')
            self.assertEqual(sql("SELECT status FROM platform_staff_invitations WHERE id='"+ident(551)+"'"), 'REVOKED')
            self.assertEqual(sql("SELECT status FROM platform_staff_invitations WHERE id='"+ident(552)+"'"), 'ACCEPTED')
            self.assertEqual(sql("SELECT count(*) FROM accounts WHERE status='ACTIVE'"), '0')
            self.assertEqual(sql('SELECT count(*) FROM platform_roles'), '0')
            self.assertFalse((root / 'accounts.json').exists())

    def test_matching_platforms_get_only_independent_credentials_and_legacy_role_is_not_promoted(self):
        self.seed_platform()
        bundle = self.snapshot()
        with backup.offline_database(self.source) as (_, __, current):
            current('UPDATE platform_accounts SET management_version=19')
            with self.offline_copy(bundle) as (root, sql):
                recovery.quarantine(sql)
                result = recovery.reopen_current(sql, current, root)
                self.assertEqual(result['platformAccountsEnabled'], 2)
                self.assertEqual(result['accountsEnabled'], 1)
                credentials = trial.private_read(root / 'accounts.json')
                self.assertEqual(root.joinpath('accounts.json').stat().st_mode & 0o777, 0o600)
                self.assertEqual([row['accountId'] for row in credentials['recovered']], [ident(1)])
                self.assertEqual({row['accountId'] for row in credentials['platformRecovered']}, {ident(501), ident(502)})
                self.assertEqual(sql("SELECT count(*) FROM platform_roles WHERE account_id='"+ident(1)+"'"), '0')
                for row in credentials['platformRecovered']:
                    identity = row['accountId']
                    self.assertEqual(row['realm'], 'platform')
                    self.assertNotIn('email', row)
                    encoded = sql(f"SELECT password_hash FROM platform_accounts WHERE account_id='{identity}'")
                    self.assertTrue(self.password_matches(row['password'], encoded))
                    self.assertFalse(self.password_matches('old-platform-password', encoded))
                    self.assertEqual(sql(f"SELECT password_hash FROM accounts WHERE id='{identity}'"), '!PLATFORM_ONLY!')
                    self.assertEqual(sql(f"SELECT credential_version||':'||management_version FROM platform_accounts WHERE account_id='{identity}'"), '9:19')
                self.assertEqual(sql('SELECT count(*) FROM tenant_memberships m JOIN platform_accounts p ON p.account_id=m.account_id'), '0')
                self.assertEqual(sql('SELECT count(*) FROM workspace_members m JOIN platform_accounts p ON p.account_id=m.account_id'), '0')
                self.assertEqual(sql('SELECT count(*) FROM platform_sessions'), '0')

    def test_changed_revoked_disabled_missing_and_customer_converted_identities_stay_closed(self):
        self.seed_platform((501, 502, 503, 504, 505))
        with backup.offline_database(self.source) as (_, __, sql):
            sql(f"INSERT INTO accounts(id,email,display_name,password_hash) VALUES('{ident(600)}','former-customer@example.invalid','Synthetic customer','old-customer-hash')")
        bundle = self.snapshot()
        with backup.offline_database(self.source) as (_, __, current):
            current(f"""UPDATE platform_accounts SET login_name='changed@example.invalid' WHERE account_id='{ident(501)}';
              DELETE FROM platform_roles WHERE account_id='{ident(502)}';
              UPDATE accounts SET status='DISABLED' WHERE id='{ident(503)}';
              DELETE FROM platform_staff_invitations WHERE accepted_by='{ident(504)}' OR invited_by='{ident(504)}';
              DELETE FROM platform_sessions WHERE account_id='{ident(504)}';
              DELETE FROM platform_accounts WHERE account_id='{ident(504)}';
              DELETE FROM platform_roles WHERE account_id='{ident(504)}';
              DELETE FROM platform_sessions WHERE account_id='{ident(505)}';
              DELETE FROM platform_accounts WHERE account_id='{ident(505)}';
              DELETE FROM platform_roles WHERE account_id='{ident(505)}';
              INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES('{ident(2)}','{ident(505)}','MEMBER');
              INSERT INTO platform_accounts(account_id,login_name,password_hash) VALUES('{ident(600)}','new-operator@example.invalid','new-platform-hash');
              INSERT INTO platform_roles VALUES('{ident(600)}','PLATFORM_ADMIN');""")
            with self.offline_copy(bundle) as (root, sql):
                recovery.quarantine(sql)
                result = recovery.reopen_current(sql, current, root)
                credentials = trial.private_read(root / 'accounts.json')
                self.assertEqual(result['platformAccountsEnabled'], 1)
                self.assertTrue(credentials['platform']['localRecoveryPlatformOnly'])
                generated = credentials['platform']['accountId']
                self.assertEqual(sql(f"SELECT count(*) FROM platform_accounts p JOIN accounts a ON a.id=p.account_id WHERE a.status='ACTIVE' AND p.account_id<>'{generated}'"), '0')
                self.assertEqual(sql('SELECT count(*) FROM platform_roles'), '1')
                self.assertEqual(sql(f"SELECT password_hash FROM accounts WHERE id='{generated}'"), '!PLATFORM_ONLY!')
                self.assertEqual(sql(f"SELECT count(*) FROM tenant_memberships WHERE account_id='{generated}'"), '0')
                self.assertEqual([row['accountId'] for row in credentials['recovered']], [ident(1)])
                self.assertEqual(sql(f"SELECT status FROM accounts WHERE id='{ident(600)}'"), 'DISABLED')
                encoded = sql(f"SELECT password_hash FROM platform_accounts WHERE account_id='{generated}'")
                self.assertTrue(self.password_matches(credentials['platform']['password'], encoded))

    def test_current_evidence_tracks_platform_credentials_and_invitations_without_exposing_them(self):
        self.seed_platform()
        with backup.offline_database(self.source) as (_, __, sql):
            before = recovery.current_evidence(sql)
            sql("UPDATE platform_accounts SET password_hash='synthetic-new-secret',management_version=12; UPDATE platform_staff_invitations SET status='REVOKED' WHERE status='PENDING'")
            after = recovery.current_evidence(sql)
            for table in ('platform_accounts', 'platform_staff_invitations'):
                self.assertNotEqual(before['controls'][table]['sha256'], after['controls'][table]['sha256'])
                self.assertRegex(after['controls'][table]['sha256'], r'^[0-9a-f]{64}$')
            for secret in ('synthetic-new-secret', 'operator-501@example.invalid', 'pending@example.invalid', 'old-platform-hash'):
                self.assertNotIn(secret, json.dumps(after))

    def test_failed_reopening_rolls_back_both_realms_and_does_not_issue_credentials(self):
        self.seed_platform()
        bundle = self.snapshot()
        with backup.offline_database(self.source) as (_, __, current):
            with self.offline_copy(bundle) as (root, sql):
                recovery.quarantine(sql)
                def fail_transaction(query, *args):
                    if query.startswith('BEGIN;'):
                        query = query.replace('COMMIT;', "SELECT 1/0; COMMIT;")
                    return sql(query, *args)
                with self.assertRaises(trial.TrialError):
                    recovery.reopen_current(fail_transaction, current, root)
                self.assertFalse((root / 'accounts.json').exists())
                self.assertEqual(sql("SELECT count(*) FROM accounts WHERE status='ACTIVE'"), '0')
                self.assertEqual(sql('SELECT count(*) FROM platform_roles'), '0')
                self.assertEqual(sql("SELECT count(*) FROM platform_accounts WHERE password_hash='!RECOVERY_DISABLED!'"), '2')
                self.assertEqual(sql("SELECT count(*) FROM tenant_memberships WHERE status='ACTIVE'"), '0')

"""Synthetic offline collection adapter checks; full recovery coverage remains closed."""
import json
import os
import unittest
import backup_experience_integration_test as fixture

backup, recovery, trial, ident = fixture.backup, fixture.recovery, fixture.trial, fixture.ident
import backup_collection as collection
import backup_experience as experience
import backup_lifecycle as lifecycle


@unittest.skipUnless(os.environ.get('RUN_BACKUP_DB_TESTS') == '1', 'explicit synthetic PostgreSQL test opt-in')
class BackupCollectionAdapterTest(unittest.TestCase):
    setUp = fixture.BackupExperienceAdapterTest.setUp
    seed = fixture.BackupExperienceAdapterTest.seed
    seed_current_modules = fixture.BackupExperienceAdapterTest.seed_current_modules
    snapshot = fixture.BackupExperienceAdapterTest.snapshot
    offline_copy = fixture.BackupExperienceAdapterTest.offline_copy
    seed_experience = fixture.BackupExperienceAdapterTest.seed_experience
    assert_guards_enabled = fixture.BackupExperienceAdapterTest.assert_guards_enabled
    departure = fixture.identity_fixture.fixture.RealBackupTest.departure

    def seed_collection(self):
        with backup.offline_database(self.source) as (_, __, sql):
            sql(f"""INSERT INTO data_connections(id,tenant_id,name,route_label,access_summary,status,time_zone)
              VALUES('{ident(3000)}','{ident(2)}','Synthetic connector','Private deployment route','Approved shared rows','READY','UTC');
            INSERT INTO business_datasets(id,tenant_id,connection_id,workspace_id,dataset_key,name,column_names)
              VALUES('{ident(3010)}','{ident(2)}','{ident(3000)}','{ident(3)}','synthetic-sales','Synthetic sales','["amount"]');
            INSERT INTO collection_runs(id,tenant_id,connection_id,execution_epoch,trigger_kind,requested_by,status,started_at,finished_at)
              VALUES('{ident(3001)}','{ident(2)}','{ident(3000)}',1,'MANUAL','{ident(1)}','SUCCEEDED',now(),now());
            INSERT INTO dataset_snapshots(id,tenant_id,connection_id,dataset_id,run_id,version,data_rows,row_count,coverage_through,collected_at)
              VALUES('{ident(3011)}','{ident(2)}','{ident(3000)}','{ident(3010)}','{ident(3001)}',1,'[[0.100000000000000000001]]',1,now(),now());
            UPDATE business_datasets SET current_snapshot='{ident(3011)}' WHERE id='{ident(3010)}';
            INSERT INTO task_dataset_reads(task_id,attempt_number,dataset_id,snapshot_id)
              VALUES('{ident(41)}',1,'{ident(3010)}','{ident(3011)}');
            UPDATE data_connections SET auto_enabled=true,frequency='HOURLY',next_due=now(),revision=8 WHERE id='{ident(3000)}';
            INSERT INTO collection_runs(id,tenant_id,connection_id,execution_epoch,trigger_kind,status,lease_token,lease_until)
              VALUES('{ident(3002)}','{ident(2)}','{ident(3000)}',1,'SCHEDULED','RUNNING','{ident(3050)}',now()+interval '1 hour');""")

    def assert_quiet(self, sql):
        self.assertEqual(sql("SELECT count(*) FROM data_connections WHERE auto_enabled OR next_due IS NOT NULL"), '0')
        self.assertEqual(sql("SELECT count(*) FROM collection_runs WHERE status IN ('QUEUED','RUNNING') OR lease_token IS NOT NULL OR lease_until IS NOT NULL"), '0')
        self.assert_guards_enabled(sql)

    def test_quarantine_preserves_snapshot_and_stops_jobs_schedules_and_old_attempts(self):
        self.seed_collection()
        bundle = self.snapshot()
        with backup.offline_database(self.source) as (_, __, current):
            with self.offline_copy(bundle) as (root, sql):
                recovery.quarantine(sql)
                result = collection.synchronize(sql, current)
                recovery.reopen_current(sql, current, root)
                recovery.reopen_configurations(sql, current)
                self.assert_quiet(sql)
                self.assertEqual(result['retainedSnapshots'], 1)
                self.assertEqual(sql(f"SELECT data_rows::text FROM dataset_snapshots WHERE id='{ident(3011)}'"), '[[0.100000000000000000001]]')
                self.assertEqual(sql(f"SELECT reason FROM collection_runs WHERE id='{ident(3002)}'"), 'RECOVERY_QUARANTINE')
                self.assertEqual(sql(f"SELECT reason FROM task_dataset_fences WHERE task_id='{ident(41)}'"), 'RECOVERY_QUARANTINE')
                self.assertEqual(current(f"SELECT status FROM collection_runs WHERE id='{ident(3002)}'"), 'RUNNING')
                with self.assertRaisesRegex(trial.TrialError, '保持隔离'):
                    recovery.coverage(sql)

    def test_current_withdrawal_configuration_and_new_head_do_not_replay_or_promote_old_data(self):
        self.seed_collection()
        bundle = self.snapshot()
        with backup.offline_database(self.source) as (_, __, current):
            current(f"""UPDATE business_datasets SET status='WITHDRAWN' WHERE id='{ident(3010)}';
            UPDATE data_connections SET status='UNAVAILABLE',frequency='DAILY',daily_time='08:30',time_zone='Asia/Shanghai',revision=30,execution_epoch=900 WHERE id='{ident(3000)}';
            UPDATE data_connections SET execution_epoch=900 WHERE id='{ident(3000)}';""")
            with self.offline_copy(bundle) as (root, sql):
                recovery.quarantine(sql)
                collection.synchronize(sql, current)
                self.assert_quiet(sql)
                self.assertEqual(sql('SELECT status FROM business_datasets'), 'WITHDRAWN')
                self.assertEqual(sql("SELECT frequency||'|'||daily_time||'|'||time_zone FROM data_connections"), 'DAILY|08:30|Asia/Shanghai')
                self.assertGreater(int(sql('SELECT execution_epoch FROM data_connections')), 900)
                self.assertGreater(int(sql('SELECT revision FROM data_connections')), 30)
                self.assertEqual(sql('SELECT scrubbed FROM dataset_snapshots'), 'f')
                current(f"""UPDATE business_datasets SET status='ACTIVE' WHERE id='{ident(3010)}';
                INSERT INTO collection_runs(id,tenant_id,connection_id,execution_epoch,trigger_kind,status)
                  VALUES('{ident(3003)}','{ident(2)}','{ident(3000)}',901,'SCHEDULED','SUCCEEDED');
                INSERT INTO dataset_snapshots(id,tenant_id,connection_id,dataset_id,run_id,version,data_rows,row_count,collected_at)
                  VALUES('{ident(3012)}','{ident(2)}','{ident(3000)}','{ident(3010)}','{ident(3003)}',2,'[[2]]',1,now());
                UPDATE business_datasets SET current_snapshot='{ident(3012)}' WHERE id='{ident(3010)}';""")
                result = collection.synchronize(sql, current)
                self.assertEqual(result['unavailableHeads'], 1)
                self.assertEqual(sql('SELECT current_snapshot IS NULL FROM business_datasets'), 't')
                self.assertEqual(sql('SELECT count(*) FROM dataset_snapshots'), '1')
                self.assertEqual(sql('SELECT status FROM business_datasets'), 'ACTIVE')
                self.assert_quiet(sql)

    def test_snapshot_tombstone_erases_source_bound_task_and_experience_without_resurrection(self):
        self.seed_experience()
        self.seed_collection()
        bundle = self.snapshot()
        with backup.offline_database(self.source) as (_, __, current):
            current(f"""UPDATE dataset_snapshots SET data_rows='[]',scrubbed=true;
            UPDATE business_datasets SET name='内容已按退出期限清理',description='',dataset_key='removed-'||id::text,column_names='["已清理"]',status='WITHDRAWN',scrubbed=true;
            UPDATE data_connections SET name='内容已按退出期限清理',route_label='',access_summary='',status='UNCONFIGURED',auto_enabled=false,next_due=NULL;""")
            with self.offline_copy(bundle) as (root, sql):
                recovery.quarantine(sql)
                result = collection.synchronize(sql, current)
                self.assertEqual(result['scrubbedSnapshots'], 1)
                self.assertEqual(sql('SELECT data_rows::text FROM dataset_snapshots'), '[]')
                self.assertEqual(sql('SELECT scrubbed FROM business_datasets'), 't')
                self.assertEqual(sql(f"SELECT scrubbed FROM experience_versions WHERE id='{ident(1003)}'"), 't')
                self.assertEqual(sql(f"SELECT method IS NULL FROM general_experience_versions WHERE id='{ident(1006)}'"), 't')
                self.assertNotEqual(sql(f"SELECT reply FROM conversation_tasks WHERE id='{ident(41)}'"), 'sensitive derived response')
                self.assertEqual(collection.synchronize(sql, current)['scrubbedSnapshots'], 0)
                self.assert_quiet(sql)

    def test_fixed_body_or_read_evidence_mismatch_fails_before_controls_change(self):
        self.seed_collection()
        bundle = self.snapshot()
        with backup.offline_database(self.source) as (_, __, current):
            # Simulate a corrupt authority in the disposable fixture, never a runtime bypass.
            current("ALTER TABLE dataset_snapshots DISABLE TRIGGER dataset_snapshot_guard; UPDATE dataset_snapshots SET data_rows='[[0.100000000000000000002]]'; ALTER TABLE dataset_snapshots ENABLE TRIGGER dataset_snapshot_guard;")
            with self.offline_copy(bundle) as (root, sql):
                recovery.quarantine(sql)
                before = sql('SELECT revision FROM data_connections')
                with self.assertRaisesRegex(trial.TrialError, '固定快照'):
                    collection.synchronize(sql, current)
                self.assertEqual(sql('SELECT revision FROM data_connections'), before)
                current("ALTER TABLE dataset_snapshots DISABLE TRIGGER dataset_snapshot_guard; UPDATE dataset_snapshots SET data_rows='[[0.100000000000000000001]]'; ALTER TABLE dataset_snapshots ENABLE TRIGGER dataset_snapshot_guard; DELETE FROM task_dataset_reads;")
                with self.assertRaisesRegex(trial.TrialError, '固定快照'):
                    collection.synchronize(sql, current)
                self.assertEqual(sql('SELECT revision FROM data_connections'), before)
                self.assert_quiet(sql)
                self.assert_guards_enabled(current)

    def test_enterprise_deadline_cleanup_is_not_member_cleanup(self):
        self.seed_collection()
        bundle = self.snapshot()
        with backup.offline_database(self.source) as (_, __, current):
            self.departure(current, 3100, 'MEMBER_OFFBOARD', 'CLEANING', ident(1))
            current("UPDATE departure_executions SET effective_at=now()-interval '31 days',deadline=now()-interval '1 day',stop_complete=true")
            with self.offline_copy(bundle) as (root, sql):
                recovery.quarantine(sql)
                lifecycle.residual(experience.isolated_sql(sql), current)
                self.assertEqual(sql('SELECT scrubbed FROM dataset_snapshots'), 'f')
                self.assertEqual(sql('SELECT scrubbed FROM business_datasets'), 'f')
                self.departure(current, 3101, state='CLEANING')
                # Before the deadline shared business data must still be retained.
                current(f"UPDATE departure_executions SET stop_complete=true WHERE id='{ident(3101)}'")
                lifecycle.residual(experience.isolated_sql(sql), current)
                self.assertEqual(sql('SELECT scrubbed FROM dataset_snapshots'), 'f')
                current(f"UPDATE departure_executions SET effective_at=now()-interval '31 days',deadline=now()-interval '1 day' WHERE id='{ident(3101)}'")
                lifecycle.residual(experience.isolated_sql(sql), current)
                self.assertEqual(sql('SELECT scrubbed FROM dataset_snapshots'), 't')
                self.assertEqual(sql('SELECT scrubbed FROM business_datasets'), 't')
                self.assertEqual(sql("SELECT status||'|'||route_label||'|'||access_summary FROM data_connections"), 'UNCONFIGURED||')
                self.assertEqual(lifecycle.residual(experience.isolated_sql(sql), current)['rows'], 0)
                self.assert_quiet(sql)

    def test_current_evidence_contains_hashes_without_business_rows_or_routes(self):
        self.seed_collection()
        with backup.offline_database(self.source) as (_, __, sql):
            before = recovery.current_evidence(sql)
            sql("UPDATE data_connections SET route_label='Changed private route'; UPDATE dataset_snapshots SET data_rows='[]',scrubbed=true")
            after = recovery.current_evidence(sql)
            for table in ('data_connections', 'dataset_snapshots'):
                self.assertNotEqual(before['controls'][table]['sha256'], after['controls'][table]['sha256'])
                self.assertRegex(after['controls'][table]['sha256'], r'^[0-9a-f]{64}$')
            for secret in ('Private deployment route', 'Changed private route', '0.100000000000000000001', 'Synthetic sales'):
                self.assertNotIn(secret, json.dumps(before)+json.dumps(after))

    def test_current_attempt_and_briefing_fences_are_atomic_and_never_cleared(self):
        self.seed_experience()
        self.seed_collection()
        with backup.offline_database(self.source) as (_, __, sql):
            sql(f"""INSERT INTO conversation_tasks(id,tenant_id,workspace_id,conversation_id,requested_by,prompt,mode,status,attempt,source_scope)
              VALUES('{ident(3020)}','{ident(2)}','{ident(3)}','{ident(40)}','{ident(1)}','Synthetic briefing','SOURCE_LOOKUP','QUEUED',1,'SELECTED');
            INSERT INTO briefing_generation_policies(id,tenant_id,owner_id,workspace_id)
              VALUES('{ident(3021)}','{ident(2)}','{ident(1)}','{ident(3)}');
            INSERT INTO briefing_generation_batches(id,tenant_id,owner_id,workspace_id,policy_id,policy_epoch,trigger_kind,status,task_id)
              VALUES('{ident(3022)}','{ident(2)}','{ident(1)}','{ident(3)}','{ident(3021)}',1,'INITIAL','QUEUED','{ident(3020)}');
            INSERT INTO briefing_dataset_selections(task_id,batch_id,dataset_id,snapshot_id)
              VALUES('{ident(3020)}','{ident(3022)}','{ident(3010)}','{ident(3011)}');
            UPDATE conversation_tasks SET status='SUCCEEDED' WHERE id='{ident(3020)}';
            UPDATE briefing_generation_batches SET status='SUCCEEDED' WHERE id='{ident(3022)}';""")
        bundle = self.snapshot()
        with backup.offline_database(self.source) as (_, __, current):
            current(f"""INSERT INTO task_dataset_fences VALUES('{ident(41)}',1,'AUTHORIZATION_REVOKED');
            UPDATE briefing_dataset_selections SET invalidated=true;
            UPDATE data_connections SET name='Current deployment',revision=90;""")
            with self.offline_copy(bundle) as (root, sql):
                recovery.quarantine(sql)
                before = sql('SELECT revision FROM data_connections')
                self.assertEqual(sql('SELECT invalidated FROM briefing_dataset_selections'), 'f')
                def fail_commit(query, *args):
                    if 'INSERT INTO task_dataset_fences(' in query:
                        query = query.replace('COMMIT;', 'SELECT 1/0; COMMIT;')
                    return sql(query, *args)
                with self.assertRaises(trial.TrialError):
                    collection.synchronize(fail_commit, current)
                self.assertEqual(sql('SELECT revision FROM data_connections'), before)
                self.assertEqual(sql('SELECT invalidated FROM briefing_dataset_selections'), 'f')
                self.assertEqual(sql('SELECT count(*) FROM task_dataset_fences'), '0')
                self.assert_guards_enabled(sql)
                result = collection.synchronize(sql, current)
                self.assertEqual(result['currentFences'], 1)
                self.assertEqual(result['invalidatedSelections'], 1)
                self.assertEqual(sql('SELECT invalidated FROM briefing_dataset_selections'), 't')
                self.assertEqual(sql('SELECT reason FROM task_dataset_fences'), 'AUTHORIZATION_REVOKED')
                collection.synchronize(sql, current)
                self.assertEqual(sql('SELECT count(*) FROM task_dataset_fences'), '1')
                self.assertEqual(sql('SELECT invalidated FROM briefing_dataset_selections'), 't')
                self.assert_quiet(sql)

    def test_completed_result_cannot_lose_new_authoritative_inheritance(self):
        self.seed_experience()
        self.seed_collection()
        bundle = self.snapshot()
        with backup.offline_database(self.source) as (_, __, current):
            current(f"""INSERT INTO conversation_tasks(id,tenant_id,workspace_id,conversation_id,requested_by,prompt,mode,status,attempt)
              VALUES('{ident(3030)}','{ident(2)}','{ident(3)}','{ident(40)}','{ident(1)}','Later source','SOURCE_LOOKUP','SUCCEEDED',1);
            INSERT INTO dataset_task_inheritance VALUES('{ident(41)}','{ident(3030)}');""")
            with self.offline_copy(bundle) as (root, sql):
                recovery.quarantine(sql)
                before = sql('SELECT revision FROM data_connections')
                with self.assertRaisesRegex(trial.TrialError, '依赖集合'):
                    collection.synchronize(sql, current)
                self.assertEqual(sql('SELECT revision FROM data_connections'), before)
                self.assertEqual(sql('SELECT count(*) FROM dataset_task_inheritance'), '0')
                self.assert_quiet(sql)

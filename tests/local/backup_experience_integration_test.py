"""Synthetic offline recovery components only; full-schema activation coverage stays closed."""
import os
import unittest
import backup_identity_integration_test as identity_fixture

backup, recovery, trial = identity_fixture.backup, identity_fixture.recovery, identity_fixture.trial
ident = identity_fixture.ident
import backup_experience as experience


@unittest.skipUnless(os.environ.get('RUN_BACKUP_DB_TESTS') == '1', 'explicit synthetic PostgreSQL test opt-in')
class BackupExperienceAdapterTest(unittest.TestCase):
    setUp = identity_fixture.BackupIdentityAdapterTest.setUp
    seed = identity_fixture.BackupIdentityAdapterTest.seed
    seed_current_modules = identity_fixture.BackupIdentityAdapterTest.seed_current_modules
    snapshot = identity_fixture.BackupIdentityAdapterTest.snapshot
    offline_copy = identity_fixture.BackupIdentityAdapterTest.offline_copy

    def seed_experience(self):
        a,t,w = map(ident, (1,2,3))
        with backup.offline_database(self.source) as (_, __, sql):
            sql(f"""UPDATE conversation_tasks SET status='SUCCEEDED',mode='AGENT',execution_class='live' WHERE id='{ident(41)}';
            UPDATE conversation_attempts SET status='SUCCEEDED' WHERE task_id='{ident(41)}';
            INSERT INTO experience_intake_sources(id,tenant_id,owner_id,workspace_id,kind,source_id,source_revision,source_attempt,task_id)
              VALUES('{ident(1001)}','{t}','{a}','{w}','TASK','{ident(41)}',0,1,'{ident(41)}');
            INSERT INTO experience_analysis_runs(id,source_id,tenant_id,lease,lease_until,state,job_hash,manifest,execution_class,outcome)
              VALUES('{ident(1002)}','{ident(1001)}','{t}','{ident(1050)}',now(),'RETURNED','{'1'*64}','{{}}','live','QUALIFIED');
            INSERT INTO experience_versions(id,entry_id,number,content,access_mode,search_terms,tags,created_by,origin,evaluation,automatic_basis,automatic_steps)
              VALUES('{ident(1003)}','{ident(50)}',2,'{{"kind":"METHOD","title":"Synthetic method"}}','SOURCE_BOUND','{{}}','{{}}','{a}','AUTOMATIC','AUTOMATIC_CHECKED','OBSERVED_EXECUTION','["Synthetic step"]');
            INSERT INTO experience_evidence(version_id,kind,reference_id,source_workspace_id,task_id)
              VALUES('{ident(1003)}','TASK','{ident(41)}','{w}','{ident(41)}');
            INSERT INTO experience_automatic_sources VALUES('{ident(1003)}','{ident(1001)}');
            INSERT INTO experience_admissions(run_id,source_id,outcome,entry_id,version_id)
              VALUES('{ident(1002)}','{ident(1001)}','CREATED','{ident(50)}','{ident(1003)}');
            INSERT INTO experience_analysis_items(source_id,tenant_id,state,run_id)
              VALUES('{ident(1001)}','{t}','QUALIFIED','{ident(1002)}');
            UPDATE experience_entries SET status='PUBLISHED',published_version='{ident(1003)}' WHERE id='{ident(50)}';
            INSERT INTO experience_generalization_sources(version_id,tenant_id,workspace_id,actor_id,state)
              VALUES('{ident(1003)}','{t}','{w}','{a}','ADMITTED');
            INSERT INTO general_experience_entries(id) VALUES('{ident(1005)}');
            INSERT INTO general_experience_versions(id,entry_id,number,method,content_fingerprint)
              VALUES('{ident(1006)}','{ident(1005)}',1,'{{"title":"Synthetic general method"}}','{'2'*64}');
            INSERT INTO general_experience_origins VALUES('{ident(1006)}','{ident(1003)}');
            UPDATE general_experience_entries SET published_version='{ident(1006)}' WHERE id='{ident(1005)}';""")
            self.assertEqual(sql(f"SELECT experience_intake_available('{ident(1001)}')"), 't')
            self.assertEqual(sql(f"SELECT general_experience_available('{ident(1006)}')"), 't')

    def assert_bodies_retained(self, sql):
        self.assertEqual(sql(f"SELECT scrubbed FROM experience_versions WHERE id='{ident(1003)}'"), 'f')
        self.assertEqual(sql(f"SELECT method IS NOT NULL FROM general_experience_versions WHERE id='{ident(1006)}'"), 't')
        self.assertEqual(sql(f"SELECT state FROM experience_intake_sources WHERE id='{ident(1001)}'"), 'PENDING')

    def assert_guards_enabled(self, sql):
        self.assertEqual(sql("SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled<>'O'"), '0')

    def test_quarantine_and_reopen_preserve_admitted_assets_and_restore_runtime_fences(self):
        self.seed_experience()
        bundle = self.snapshot()
        with backup.offline_database(self.source) as (_, __, current):
            with self.offline_copy(bundle) as (root, sql):
                recovery.quarantine(sql)
                self.assert_bodies_retained(sql)
                self.assert_guards_enabled(sql)
                self.assertEqual(sql(f"SELECT general_experience_available('{ident(1006)}')"), 'f')
                recovery.reopen_current(sql, current, root)
                recovery.reopen_configurations(sql, current)
                experience.revalidate(experience.isolated_sql(sql))
                self.assert_bodies_retained(sql)
                self.assert_guards_enabled(sql)
                self.assertEqual(sql(f"SELECT general_experience_available('{ident(1006)}')"), 't')
                # An ordinary business revocation after recovery must still erase the source chain.
                sql(f"DELETE FROM workspace_members WHERE workspace_id='{ident(3)}'")
                self.assertEqual(sql(f"SELECT scrubbed FROM experience_versions WHERE id='{ident(1003)}'"), 't')
                self.assertEqual(sql(f"SELECT method IS NULL FROM general_experience_versions WHERE id='{ident(1006)}'"), 't')

    def test_current_revocation_erases_retained_assets_after_reconstruction(self):
        self.seed_experience()
        bundle = self.snapshot()
        with backup.offline_database(self.source) as (_, __, current):
            current(f"DELETE FROM workspace_members WHERE workspace_id='{ident(3)}'")
            with self.offline_copy(bundle) as (root, sql):
                recovery.quarantine(sql)
                self.assert_bodies_retained(sql)
                recovery.reopen_current(sql, current, root)
                recovery.reopen_configurations(sql, current)
                experience.revalidate(experience.isolated_sql(sql))
                self.assertEqual(sql(f"SELECT state FROM experience_intake_sources WHERE id='{ident(1001)}'"), 'SOURCE_UNAVAILABLE')
                self.assertEqual(sql(f"SELECT scrubbed FROM experience_versions WHERE id='{ident(1003)}'"), 't')
                self.assertEqual(sql(f"SELECT method IS NULL FROM general_experience_versions WHERE id='{ident(1006)}'"), 't')
                self.assert_guards_enabled(sql)

    def test_actual_source_erasure_remains_enabled_inside_isolation(self):
        self.seed_experience()
        bundle = self.snapshot()
        with self.offline_copy(bundle) as (root, sql):
            recovery.quarantine(sql)
            protected = experience.isolated_sql(sql)
            # An unrelated real deletion must not run a global unavailable scan against closed accounts.
            protected(f"SELECT scrub_lifecycle_object('PROFILE_VERSION','{ident(71)}')")
            self.assert_bodies_retained(sql)
            protected(f"SELECT scrub_lifecycle_object('TASK','{ident(41)}')")
            self.assertEqual(sql(f"SELECT scrubbed FROM experience_versions WHERE id='{ident(1003)}'"), 't')
            self.assertEqual(sql(f"SELECT method IS NULL FROM general_experience_versions WHERE id='{ident(1006)}'"), 't')
            self.assert_guards_enabled(sql)

    def test_failed_mutation_rolls_back_trigger_changes_and_pre_disabled_trigger_is_rejected(self):
        self.seed_experience()
        with backup.offline_database(self.source) as (_, __, sql):
            protected = experience.isolated_sql(sql)
            with self.assertRaises(trial.TrialError):
                protected("BEGIN; UPDATE accounts SET status='DISABLED'; SELECT 1/0; COMMIT;")
            self.assertEqual(sql("SELECT status FROM accounts WHERE id='"+ident(1)+"'"), 'ACTIVE')
            self.assert_bodies_retained(sql)
            self.assert_guards_enabled(sql)
            # Disabling named availability triggers never disables the deferred version FK.
            with self.assertRaises(trial.TrialError):
                protected(f"UPDATE experience_entries SET published_version='{ident(9999)}' WHERE id='{ident(50)}'")
            self.assertEqual(sql(f"SELECT published_version FROM experience_entries WHERE id='{ident(50)}'"), ident(1003))
            self.assert_guards_enabled(sql)
            sql('ALTER TABLE accounts DISABLE TRIGGER experience_intake_account')
            with self.assertRaises(trial.TrialError):
                protected("UPDATE accounts SET status='DISABLED'")
            self.assertEqual(sql("SELECT status FROM accounts WHERE id='"+ident(1)+"'"), 'ACTIVE')
            sql('ALTER TABLE accounts ENABLE TRIGGER experience_intake_account')
            # Even successful metadata reads leave no disabled trigger or extra output tags.
            self.assertEqual(protected("SELECT json_build_object('checked',true)::text"), '{"checked" : true}')
            self.assertEqual(protected('COPY (SELECT 1) TO STDOUT', True), sql('COPY (SELECT 1) TO STDOUT', True))

    def test_unfinished_analysis_contribution_and_platform_adjustment_do_not_replay(self):
        self.seed_experience()
        with backup.offline_database(self.source) as (_, __, sql):
            sql(f"""INSERT INTO experience_intake_sources(id,tenant_id,owner_id,workspace_id,kind,source_id,source_revision,source_attempt,task_id)
              VALUES('{ident(1007)}','{ident(2)}','{ident(1)}','{ident(3)}','TASK','{ident(41)}',1,1,'{ident(41)}');
            INSERT INTO experience_analysis_runs(id,source_id,tenant_id,lease,lease_until,state,job_hash,manifest,candidate)
              VALUES('{ident(1008)}','{ident(1007)}','{ident(2)}','{ident(1051)}',now()+interval '1 hour','DISPATCHED','{'3'*64}','{{}}','{{"draft":true}}');
            INSERT INTO experience_analysis_items(source_id,tenant_id,state,run_id)
              VALUES('{ident(1007)}','{ident(2)}','RUNNING','{ident(1008)}');
            INSERT INTO experience_generalization_sources(version_id,tenant_id,workspace_id,actor_id,state)
              VALUES('{ident(51)}','{ident(2)}','{ident(3)}','{ident(1)}','RUNNING');
            INSERT INTO experience_generalization_runs(id,source_id,tenant_id,lease,lease_until,state,job_hash,method)
              VALUES('{ident(1018)}','{ident(51)}','{ident(2)}','{ident(1052)}',now()+interval '1 hour','DISPATCHED','{'4'*64}','{{"draft":true}}');
            UPDATE experience_generalization_sources SET run_id='{ident(1018)}' WHERE version_id='{ident(51)}';
            INSERT INTO general_experience_adjustments(id,actor_id,request_id,request_hash,entry_id,version_id,expected_revision,content,state)
              VALUES('{ident(1020)}','{ident(1)}','{ident(1021)}','{'5'*64}','{ident(1005)}','{ident(1006)}',1,'Synthetic pending change','RUNNING');
            INSERT INTO general_experience_adjustment_runs(id,proposal_id,phase,lease,lease_until,job_hash,state,receipt)
              VALUES('{ident(1022)}','{ident(1020)}','EXTRACT','{ident(1053)}',now()+interval '1 hour','{'6'*64}','DISPATCHED','{{"draft":true}}');
            UPDATE general_experience_adjustments SET run_id='{ident(1022)}' WHERE id='{ident(1020)}';""")
        bundle = self.snapshot()
        with self.offline_copy(bundle) as (root, sql):
            recovery.quarantine(sql)
            self.assert_bodies_retained(sql)
            self.assertEqual(sql(f"SELECT state||':'||(candidate IS NULL)::text FROM experience_analysis_runs WHERE id='{ident(1008)}'"), 'CANCELLED:true')
            self.assertEqual(sql(f"SELECT state FROM experience_analysis_items WHERE source_id='{ident(1007)}'"), 'SOURCE_UNAVAILABLE')
            self.assertEqual(sql(f"SELECT state||':'||(method IS NULL)::text FROM experience_generalization_runs WHERE id='{ident(1018)}'"), 'CANCELLED:true')
            self.assertEqual(sql(f"SELECT state||':'||(content IS NULL)::text FROM general_experience_adjustments WHERE id='{ident(1020)}'"), 'UNAVAILABLE:true')
            self.assertEqual(sql(f"SELECT state||':'||(receipt IS NULL)::text FROM general_experience_adjustment_runs WHERE id='{ident(1022)}'"), 'CANCELLED:true')
            self.assert_guards_enabled(sql)

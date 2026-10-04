"""Current experience controls on real synthetic offline snapshots, not full recovery certification."""
import os
import unittest
import backup_experience_integration_test as fixture

backup, recovery, trial, experience, ident = fixture.backup, fixture.recovery, fixture.trial, fixture.experience, fixture.ident


@unittest.skipUnless(os.environ.get('RUN_BACKUP_DB_TESTS') == '1', 'explicit synthetic PostgreSQL test opt-in')
class BackupExperienceSyncTest(unittest.TestCase):
    setUp = fixture.BackupExperienceAdapterTest.setUp
    seed = fixture.BackupExperienceAdapterTest.seed
    seed_current_modules = fixture.BackupExperienceAdapterTest.seed_current_modules
    snapshot = fixture.BackupExperienceAdapterTest.snapshot
    offline_copy = fixture.BackupExperienceAdapterTest.offline_copy
    seed_experience = fixture.BackupExperienceAdapterTest.seed_experience
    assert_bodies_retained = fixture.BackupExperienceAdapterTest.assert_bodies_retained
    assert_guards_enabled = fixture.BackupExperienceAdapterTest.assert_guards_enabled

    def reopen(self, sql, current, root):
        result = experience.synchronize(sql, current)
        recovery.reopen_current(sql, current, root)
        recovery.reopen_configurations(sql, current)
        experience.revalidate(experience.isolated_sql(sql))
        return result

    def test_current_global_stop_and_tenant_stop_preserve_history_and_copy_actual_events(self):
        self.seed_experience()
        bundle = self.snapshot()
        with backup.offline_database(self.source) as (_, __, current):
            current(f"""UPDATE general_experience_entries SET status='STOPPED',revision=2,updated_at=now() WHERE id='{ident(1005)}';
            INSERT INTO general_experience_management_events(id,actor_id,request_id,entry_id,version_id,expected_revision,revision,status,reason)
              VALUES('{ident(2001)}','{ident(1)}','{ident(2002)}','{ident(1005)}','{ident(1006)}',1,2,'STOPPED','Synthetic current stop');
            INSERT INTO tenant_general_experience_usage VALUES('{ident(2)}','{ident(1005)}',false,1,now());
            INSERT INTO tenant_general_experience_usage_events(tenant_id,request_id,actor_id,entry_id,version_id,expected_revision,enabled,revision)
              VALUES('{ident(2)}','{ident(2003)}','{ident(1)}','{ident(1005)}','{ident(1006)}',0,false,1);
            INSERT INTO tenants(id,name) VALUES('{ident(2999)}','Later synthetic tenant');
            INSERT INTO tenant_general_experience_usage VALUES('{ident(2999)}','{ident(1005)}',false,1,now());
            INSERT INTO tenant_general_experience_usage_events(tenant_id,request_id,actor_id,entry_id,version_id,expected_revision,enabled,revision)
              VALUES('{ident(2999)}','{ident(2004)}','{ident(1)}','{ident(1005)}','{ident(1006)}',0,false,1);""")
            with self.offline_copy(bundle) as (root, sql):
                recovery.quarantine(sql)
                result = self.reopen(sql, current, root)
                self.assertEqual(result['eventsCopied'], 2)
                self.assertEqual(result['usageControls'], 1)
                self.assertEqual(result['eventsOutsideSnapshot'], 1)
                self.assert_bodies_retained(sql)
                self.assertEqual(sql(f"SELECT status||':'||revision FROM general_experience_entries WHERE id='{ident(1005)}'"), 'STOPPED:2')
                self.assertEqual(sql(f"SELECT general_experience_history_readable('{ident(1006)}')"), 't')
                self.assertEqual(sql(f"SELECT general_experience_available('{ident(1006)}')"), 'f')
                self.assertEqual(sql(f"SELECT enabled FROM tenant_general_experience_usage WHERE tenant_id='{ident(2)}'"), 'f')
                self.assertEqual(sql('SELECT reason FROM general_experience_management_events'), 'Synthetic current stop')
                repeated = experience.synchronize(sql, current)
                self.assertEqual(repeated['eventsCopied'], 0)
                self.assertEqual(sql('SELECT count(*) FROM tenant_general_experience_usage_events'), '1')
                self.assert_guards_enabled(sql)

    def test_current_restore_replaces_old_stop_without_replaying_or_inventing_events(self):
        self.seed_experience()
        with backup.offline_database(self.source) as (_, __, sql):
            sql(f"UPDATE general_experience_entries SET status='STOPPED',revision=2 WHERE id='{ident(1005)}'; INSERT INTO tenant_general_experience_usage VALUES('{ident(2)}','{ident(1005)}',false,1,now())")
        bundle = self.snapshot()
        with backup.offline_database(self.source) as (_, __, current):
            current(f"UPDATE general_experience_entries SET status='AVAILABLE',revision=3 WHERE id='{ident(1005)}'; UPDATE tenant_general_experience_usage SET enabled=true,revision=2")
            with self.offline_copy(bundle) as (root, sql):
                recovery.quarantine(sql)
                result = self.reopen(sql, current, root)
                self.assertEqual(result['eventsCopied'], 0)
                self.assert_bodies_retained(sql)
                self.assertEqual(sql(f"SELECT general_experience_available('{ident(1006)}')"), 't')
                self.assertEqual(sql(f"SELECT tenant_general_experience_enabled('{ident(2)}','{ident(1005)}')"), 't')
                self.assertEqual(sql('SELECT count(*) FROM general_experience_management_events'), '0')
                self.assertEqual(sql("SELECT count(*) FROM experience_analysis_runs WHERE state IN ('CLAIMED','DISPATCHED')"), '0')

    def test_new_heads_outside_snapshot_are_not_replaced_by_older_versions(self):
        self.seed_experience()
        bundle = self.snapshot()
        with backup.offline_database(self.source) as (_, __, current):
            current(f"""INSERT INTO experience_versions(id,entry_id,number,content,access_mode,search_terms,tags,created_by,origin,evaluation,automatic_basis,automatic_steps)
              SELECT '{ident(1103)}',entry_id,3,'{{"kind":"METHOD","title":"Later checked method"}}',access_mode,search_terms,tags,created_by,origin,evaluation,automatic_basis,automatic_steps FROM experience_versions WHERE id='{ident(1003)}';
            INSERT INTO experience_automatic_sources VALUES('{ident(1103)}','{ident(1001)}');
            INSERT INTO experience_analysis_runs(id,source_id,tenant_id,lease,lease_until,state,job_hash,manifest,execution_class,outcome)
              VALUES('{ident(1102)}','{ident(1001)}','{ident(2)}','{ident(1150)}',now(),'RETURNED','{'3'*64}','{{}}','live','QUALIFIED');
            INSERT INTO experience_admissions(run_id,source_id,outcome,entry_id,version_id)
              VALUES('{ident(1102)}','{ident(1001)}','UPDATED','{ident(50)}','{ident(1103)}');
            UPDATE experience_entries SET published_version='{ident(1103)}',revision=2,latest_number=3,updated_at=now() WHERE id='{ident(50)}';
            INSERT INTO experience_events VALUES('{ident(1100)}','{ident(50)}','{ident(1103)}',2,'PUBLISHED','{ident(1)}',now());
            INSERT INTO experience_generalization_sources(version_id,tenant_id,workspace_id,actor_id,state)
              VALUES('{ident(1103)}','{ident(2)}','{ident(3)}','{ident(1)}','ADMITTED');
            INSERT INTO general_experience_versions(id,entry_id,number,method,content_fingerprint)
              VALUES('{ident(1106)}','{ident(1005)}',2,'{{"title":"Later cleaned method"}}','{'4'*64}');
            INSERT INTO general_experience_origins VALUES('{ident(1106)}','{ident(1103)}');
            UPDATE general_experience_entries SET published_version='{ident(1106)}',revision=2 WHERE id='{ident(1005)}';""")
            with self.offline_copy(bundle) as (root, sql):
                recovery.quarantine(sql)
                result = self.reopen(sql, current, root)
                self.assertEqual(result['unavailableHeads'], 2)
                self.assertEqual(result['eventsOutsideSnapshot'], 1)
                self.assert_bodies_retained(sql)
                self.assertEqual(sql(f"SELECT published_version IS NULL FROM experience_entries WHERE id='{ident(50)}'"), 't')
                self.assertEqual(sql(f"SELECT published_version IS NULL FROM general_experience_entries WHERE id='{ident(1005)}'"), 't')
                self.assertEqual(sql(f"SELECT general_experience_history_readable('{ident(1006)}')"), 't')
                self.assertEqual(sql(f"SELECT general_experience_available('{ident(1006)}')"), 'f')
                self.assertEqual(sql(f"SELECT count(*) FROM general_experience_versions WHERE id='{ident(1106)}'"), '0')
                self.assertEqual(current(f"SELECT published_version FROM general_experience_entries WHERE id='{ident(1005)}'"), ident(1106))

    def test_temporary_business_revocation_stays_irreversible_after_grant_returns(self):
        self.seed_experience()
        bundle = self.snapshot()
        with backup.offline_database(self.source) as (_, __, current):
            current(f"DELETE FROM workspace_members WHERE workspace_id='{ident(3)}'; INSERT INTO workspace_members VALUES('{ident(2)}','{ident(3)}','{ident(1)}',true)")
            with self.offline_copy(bundle) as (root, sql):
                recovery.quarantine(sql)
                result = self.reopen(sql, current, root)
                self.assertGreater(result['sourceTombstones'], 0)
                self.assertEqual(sql(f"SELECT state FROM experience_intake_sources WHERE id='{ident(1001)}'"), 'SOURCE_UNAVAILABLE')
                self.assertEqual(sql(f"SELECT scrubbed FROM experience_versions WHERE id='{ident(1003)}'"), 't')
                self.assertEqual(sql(f"SELECT method IS NULL FROM general_experience_versions WHERE id='{ident(1006)}'"), 't')
                self.assertEqual(sql(f"SELECT general_experience_available('{ident(1006)}')"), 'f')
                self.assert_guards_enabled(sql)

    def test_changed_immutable_body_or_dependency_fails_before_any_control_is_applied(self):
        self.seed_experience()
        with backup.offline_database(self.source) as (_, __, sql):
            sql(f"UPDATE general_experience_versions SET method=method||'{{\"weight\":0.100000000000000000001}}'::jsonb WHERE id='{ident(1006)}'")
        bundle = self.snapshot()
        with backup.offline_database(self.source) as (_, __, current):
            with self.offline_copy(bundle) as (root, sql):
                recovery.quarantine(sql)
                current(f"UPDATE general_experience_entries SET status='STOPPED',revision=2 WHERE id='{ident(1005)}'; UPDATE general_experience_versions SET method=method||'{{\"weight\":0.100000000000000000002}}'::jsonb WHERE id='{ident(1006)}'")
                with self.assertRaisesRegex(trial.TrialError, '固定版本或来源依赖'):
                    experience.synchronize(sql, current)
                self.assertEqual(sql(f"SELECT status FROM general_experience_entries WHERE id='{ident(1005)}'"), 'AVAILABLE')
                current(f"UPDATE general_experience_versions SET method=method||'{{\"weight\":0.100000000000000000001}}'::jsonb WHERE id='{ident(1006)}'; INSERT INTO experience_automatic_dependencies VALUES('{ident(1003)}','{ident(51)}')")
                with self.assertRaisesRegex(trial.TrialError, '固定版本或来源依赖'):
                    experience.synchronize(sql, current)
                self.assertEqual(sql(f"SELECT status FROM general_experience_entries WHERE id='{ident(1005)}'"), 'AVAILABLE')
                self.assert_bodies_retained(sql)
                self.assert_guards_enabled(sql)

    def test_current_local_stop_keeps_own_version_but_does_not_reopen_it(self):
        self.seed_experience()
        bundle = self.snapshot()
        with backup.offline_database(self.source) as (_, __, current):
            current(f"""UPDATE experience_entries SET status='WITHDRAWN',published_version=NULL,automation_stopped=true,revision=2,updated_at=now() WHERE id='{ident(50)}';
            INSERT INTO experience_events VALUES('{ident(2100)}','{ident(50)}','{ident(1003)}',2,'WITHDRAWN','{ident(1)}',now());""")
            with self.offline_copy(bundle) as (root, sql):
                recovery.quarantine(sql)
                result = self.reopen(sql, current, root)
                self.assertEqual(result['eventsCopied'], 1)
                self.assertEqual(sql(f"SELECT status||':'||automation_stopped::text||':'||revision FROM experience_entries WHERE id='{ident(50)}'"), 'WITHDRAWN:true:2')
                self.assertEqual(sql(f"SELECT scrubbed FROM experience_versions WHERE id='{ident(1003)}'"), 'f')
                self.assertEqual(sql(f"SELECT method IS NULL FROM general_experience_versions WHERE id='{ident(1006)}'"), 't')
                self.assertEqual(sql(f"SELECT action FROM experience_events WHERE id='{ident(2100)}'"), 'WITHDRAWN')
                self.assert_guards_enabled(sql)

    def test_platform_adjustment_keeps_exact_phase_proof_and_evidence_contains_only_hashes(self):
        import json
        self.seed_experience()
        with backup.offline_database(self.source) as (_, __, sql):
            sql(f"""INSERT INTO general_experience_versions(id,entry_id,number,method,content_fingerprint)
              VALUES('{ident(2200)}','{ident(1005)}',2,'{{"title":"Synthetic checked adjustment"}}','{'7'*64}');
            INSERT INTO general_experience_adjustments(id,actor_id,request_id,request_hash,entry_id,version_id,expected_revision,state,result_version)
              VALUES('{ident(2201)}','{ident(1)}','{ident(2202)}','{'8'*64}','{ident(1005)}','{ident(1006)}',1,'ADMITTED','{ident(2200)}');
            INSERT INTO general_experience_adjustment_runs(id,proposal_id,phase,lease,lease_until,job_hash,state,execution_class,outcome)
              VALUES('{ident(2203)}','{ident(2201)}','EXTRACT','{ident(2205)}',now(),'{'9'*64}','RETURNED','live','QUALIFIED'),
                    ('{ident(2204)}','{ident(2201)}','GENERALIZE','{ident(2206)}',now(),'{'a'*64}','RETURNED','live','QUALIFIED');
            UPDATE general_experience_adjustments SET extraction_run='{ident(2203)}',run_id='{ident(2204)}' WHERE id='{ident(2201)}';
            INSERT INTO general_experience_version_dependencies VALUES('{ident(2200)}','{ident(1006)}','{ident(2201)}');
            UPDATE general_experience_entries SET published_version='{ident(2200)}',revision=2 WHERE id='{ident(1005)}';""")
            self.assertEqual(sql(f"SELECT general_experience_available('{ident(2200)}')"), 't')
        bundle = self.snapshot()
        with backup.offline_database(self.source) as (_, __, current):
            before = recovery.current_evidence(current)
            with self.offline_copy(bundle) as (root, sql):
                recovery.quarantine(sql)
                self.reopen(sql, current, root)
                self.assertEqual(sql(f"SELECT general_experience_available('{ident(2200)}')"), 't')
                current(f"UPDATE general_experience_adjustment_runs SET execution_class='verification' WHERE id='{ident(2204)}'")
                with self.assertRaisesRegex(trial.TrialError, '固定版本或来源依赖'):
                    experience.synchronize(sql, current)
                after = recovery.current_evidence(current)
                self.assertNotEqual(before['controls']['general_experience_adjustment_runs']['sha256'], after['controls']['general_experience_adjustment_runs']['sha256'])
                for private_text in ('Synthetic checked adjustment','Synthetic method','source-bound experience'):
                    self.assertNotIn(private_text, json.dumps(after))
                self.assert_guards_enabled(sql)

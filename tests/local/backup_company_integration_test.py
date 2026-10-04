"""Synthetic offline company-profile adapters, without authorizing complete recovery."""
import json
import os
import unittest
import backup_experience_integration_test as fixture

backup, recovery, trial, ident = fixture.backup, fixture.recovery, fixture.trial, fixture.ident
import backup_company as company
import backup_experience as experience


@unittest.skipUnless(os.environ.get('RUN_BACKUP_DB_TESTS') == '1', 'explicit synthetic PostgreSQL test opt-in')
class BackupCompanyAdapterTest(unittest.TestCase):
    setUp = fixture.BackupExperienceAdapterTest.setUp
    seed = fixture.BackupExperienceAdapterTest.seed
    seed_current_modules = fixture.BackupExperienceAdapterTest.seed_current_modules
    snapshot = fixture.BackupExperienceAdapterTest.snapshot
    offline_copy = fixture.BackupExperienceAdapterTest.offline_copy
    assert_guards_enabled = fixture.BackupExperienceAdapterTest.assert_guards_enabled

    def seed_company(self):
        with backup.offline_database(self.source) as (_, __, sql):
            sql(f"""INSERT INTO company_information_groups(tenant_id,field,revision) VALUES('{ident(2)}','INDUSTRY',2);
            INSERT INTO profile_entries(id,tenant_id,scope,entry_key,kind,created_by)
              VALUES('{ident(4000)}','{ident(2)}','TENANT','company.industry.synthetic','FACT','{ident(1)}');
            INSERT INTO profile_versions(id,tenant_id,entry_id,revision,value,provenance,status,changed_by)
              VALUES('{ident(4001)}','{ident(2)}','{ident(4000)}',1,'{{"label":"Synthetic industry","meaning":""}}','Synthetic evidence','ACTIVE','{ident(1)}');
            INSERT INTO company_information_tags VALUES('{ident(4000)}','{ident(2)}','INDUSTRY','AI',false);
            INSERT INTO company_inference_runs(id,tenant_id,actor_id,state,lease_token,lease_until,group_revisions,finished_at)
              VALUES('{ident(4010)}','{ident(2)}','{ident(1)}','SUCCEEDED','{ident(4090)}',now()+interval '1 hour','{{"INDUSTRY":1}}',now());
            INSERT INTO company_inference_inputs VALUES('{ident(4010)}','{ident(43)}',true);
            INSERT INTO company_profile_inferences VALUES('{ident(4001)}','{ident(4010)}');
            INSERT INTO company_information_suggestions(id,tenant_id,run_id,field,target_id,label,meaning,state)
              VALUES('{ident(4020)}','{ident(2)}','{ident(4010)}','INDUSTRY','{ident(4000)}','Synthetic industry','','APPLIED');
            INSERT INTO company_suggestion_evidence VALUES('{ident(4020)}','{ident(43)}',0,5);
            INSERT INTO company_analysis_attempts(run_id,tenant_id,state,engine_version,model_name,model_calls,input_tokens,output_tokens,execution_class)
              VALUES('{ident(4010)}','{ident(2)}','RETURNED','synthetic-v1','synthetic-model',1,20,5,'verification');
            INSERT INTO company_analysis_items(chunk_id,tenant_id,state,run_id,attempts)
              VALUES('{ident(43)}','{ident(2)}','SUCCEEDED','{ident(4010)}',1);""")
            self.assertEqual(sql(f"SELECT company_profile_readable('{ident(4001)}')"), 't')

    def reopen(self, sql, current, root):
        result = company.synchronize(sql, current)
        recovery.reopen_current(sql, current, root)
        recovery.reopen_configurations(sql, current)
        company.revalidate(experience.isolated_sql(sql))
        self.assert_guards_enabled(sql)
        return result

    def test_temporary_isolation_preserves_successful_profile_and_runtime_revocation_still_fences(self):
        self.seed_company()
        bundle = self.snapshot()
        with backup.offline_database(self.source) as (_, __, current):
            with self.offline_copy(bundle) as (root, sql):
                recovery.quarantine(sql)
                self.assertEqual(sql('SELECT fenced FROM company_inference_runs'), 'f')
                self.assertEqual(sql(f"SELECT company_profile_readable('{ident(4001)}')"), 'f')
                # A real unrelated removal during temporary closure must not fence every company run.
                experience.isolated_sql(sql)(f"INSERT INTO content_lifecycle(tenant_id,workspace_id,object_kind,object_id,state) VALUES('{ident(2)}','{ident(3)}','MATERIAL','{ident(20)}','TRASHED')")
                self.assertEqual(sql('SELECT fenced FROM company_inference_runs'), 'f')
                self.reopen(sql, current, root)
                self.assertEqual(sql(f"SELECT company_profile_readable('{ident(4001)}')"), 't')
                self.assertEqual(sql(f"SELECT status FROM profile_versions WHERE id='{ident(4001)}'"), 'ACTIVE')
                sql(f"DELETE FROM workspace_members WHERE workspace_id='{ident(3)}'")
                self.assertEqual(sql('SELECT fenced FROM company_inference_runs'), 't')

    def test_actual_current_revocation_then_regrant_cannot_revive_old_inference(self):
        self.seed_company()
        bundle = self.snapshot()
        with backup.offline_database(self.source) as (_, __, current):
            current(f"DELETE FROM workspace_members WHERE workspace_id='{ident(3)}'; INSERT INTO workspace_members(tenant_id,workspace_id,account_id) VALUES('{ident(2)}','{ident(3)}','{ident(1)}')")
            with self.offline_copy(bundle) as (root, sql):
                recovery.quarantine(sql)
                self.reopen(sql, current, root)
                self.assertEqual(sql('SELECT fenced FROM company_inference_runs'), 't')
                self.assertEqual(sql('SELECT state FROM company_analysis_items'), 'FAILED')
                self.assertEqual(sql(f"SELECT status FROM profile_versions WHERE id='{ident(4001)}'"), 'WITHDRAWN')
                self.assertEqual(sql(f"SELECT company_profile_readable('{ident(4001)}')"), 'f')

    def test_source_tombstone_scrubs_labels_suggestions_and_fixed_history(self):
        self.seed_company()
        bundle = self.snapshot()
        with backup.offline_database(self.source) as (_, __, current):
            current(f"UPDATE knowledge_chunks SET content='',locator='REMOVED' WHERE id='{ident(43)}'")
            with self.offline_copy(bundle) as (root, sql):
                recovery.quarantine(sql)
                self.reopen(sql, current, root)
                self.assertEqual(sql('SELECT label||meaning FROM company_information_suggestions'), '')
                self.assertEqual(sql('SELECT scrubbed FROM company_information_suggestions'), 't')
                self.assertEqual(sql(f"SELECT scrubbed FROM profile_versions WHERE id='{ident(4001)}'"), 't')
                self.assertEqual(sql(f"SELECT content FROM knowledge_chunks WHERE id='{ident(43)}'"), '')
                self.assertEqual(sql(f"SELECT locator FROM knowledge_chunks WHERE id='{ident(43)}'"), 'REMOVED')
                self.assertEqual(company.synchronize(sql, current)['scrubbedSuggestions'], 0)

    def test_current_human_protection_and_missing_new_version_do_not_reopen_old_label(self):
        self.seed_company()
        bundle = self.snapshot()
        with backup.offline_database(self.source) as (_, __, current):
            current(f"""UPDATE company_information_groups SET revision=9,manually_cleared=true,protect_new_inferences=true;
            UPDATE company_information_tags SET origin='HUMAN',human_protected=true;
            INSERT INTO profile_versions(id,tenant_id,entry_id,revision,value,provenance,status,changed_by)
              VALUES('{ident(4002)}','{ident(2)}','{ident(4000)}',2,'{{"label":"Human value","meaning":""}}','Manual','ACTIVE','{ident(1)}');
            UPDATE profile_entries SET revision=2 WHERE id='{ident(4000)}';
            INSERT INTO company_profile_inferences VALUES('{ident(4002)}','{ident(4010)}');""")
            with self.offline_copy(bundle) as (root, sql):
                recovery.quarantine(sql)
                result = self.reopen(sql, current, root)
                self.assertEqual(result['unavailableHeads'], 1)
                self.assertEqual(sql("SELECT revision||'|'||manually_cleared||'|'||protect_new_inferences FROM company_information_groups"), '9|true|true')
                self.assertEqual(sql("SELECT origin||'|'||human_protected FROM company_information_tags"), 'HUMAN|true')
                self.assertEqual(sql(f"SELECT revision FROM profile_entries WHERE id='{ident(4000)}'"), '2')
                self.assertEqual(sql(f"SELECT count(*) FROM profile_versions WHERE entry_id='{ident(4000)}'"), '1')
                self.assertEqual(sql(f"SELECT status FROM profile_versions WHERE id='{ident(4001)}'"), 'WITHDRAWN')

    def test_fixed_source_body_and_dependency_changes_fail_before_control_updates(self):
        self.seed_company()
        bundle = self.snapshot()
        with backup.offline_database(self.source) as (_, __, current):
            current(f"UPDATE knowledge_chunks SET content='Different source text' WHERE id='{ident(43)}'; UPDATE company_information_groups SET revision=99")
            with self.offline_copy(bundle) as (root, sql):
                recovery.quarantine(sql)
                with self.assertRaisesRegex(trial.TrialError, '固定版本'):
                    company.synchronize(sql, current)
                self.assertEqual(sql('SELECT revision FROM company_information_groups'), '2')
                current(f"UPDATE knowledge_chunks SET content='sensitive chunk' WHERE id='{ident(43)}'; UPDATE company_inference_inputs SET model_visible=false")
                with self.assertRaisesRegex(trial.TrialError, '固定来源集合'):
                    company.synchronize(sql, current)
                self.assertEqual(sql('SELECT revision FROM company_information_groups'), '2')
                self.assert_guards_enabled(sql)

    def test_old_pending_analysis_never_reopens_as_discoverable_cancelled_work(self):
        self.seed_company()
        with backup.offline_database(self.source) as (_, __, sql):
            sql(f"""INSERT INTO knowledge_chunks(id,tenant_id,workspace_id,material_id,version_id,run_id,ordinal,locator,method,content)
              SELECT '{ident(4050)}',tenant_id,workspace_id,material_id,version_id,run_id,1,'line2',method,'Synthetic second input' FROM knowledge_chunks WHERE id='{ident(43)}';
            INSERT INTO company_inference_runs(id,tenant_id,actor_id,state,lease_token,lease_until,group_revisions)
              VALUES('{ident(4011)}','{ident(2)}','{ident(1)}','RUNNING','{ident(4091)}',now()+interval '1 hour','{{"INDUSTRY":2}}');
            INSERT INTO company_inference_inputs VALUES('{ident(4011)}','{ident(4050)}',true);
            INSERT INTO company_analysis_attempts(run_id,tenant_id,state) VALUES('{ident(4011)}','{ident(2)}','DISPATCHED');
            INSERT INTO company_analysis_items(chunk_id,tenant_id,state,run_id,attempts)
              VALUES('{ident(4050)}','{ident(2)}','RUNNING','{ident(4011)}',1);""")
        bundle = self.snapshot()
        with backup.offline_database(self.source) as (_, __, current):
            with self.offline_copy(bundle) as (root, sql):
                recovery.quarantine(sql)
                self.reopen(sql, current, root)
                self.assertEqual(sql(f"SELECT state||'|'||fenced FROM company_inference_runs WHERE id='{ident(4011)}'"), 'CANCELLED|true')
                self.assertEqual(sql(f"SELECT state||'|'||error_code FROM company_analysis_items WHERE run_id='{ident(4011)}'"), 'FAILED|RECOVERY_QUARANTINE')
                self.assertEqual(sql(f"SELECT state FROM company_analysis_attempts WHERE run_id='{ident(4011)}'"), 'CANCELLED')
                self.assertEqual(sql(f"SELECT model_calls IS NULL FROM company_analysis_attempts WHERE run_id='{ident(4011)}'"), 't')
                self.assertEqual(sql(f"SELECT lease_until<=clock_timestamp() FROM company_inference_runs WHERE id='{ident(4011)}'"), 't')
                self.assertEqual(sql(f"SELECT state FROM company_analysis_items WHERE run_id='{ident(4010)}'"), 'SUCCEEDED')

    def test_company_control_evidence_is_private_and_failed_sync_rolls_back(self):
        self.seed_company()
        bundle = self.snapshot()
        with backup.offline_database(self.source) as (_, __, current):
            before = recovery.current_evidence(current)
            current('UPDATE company_information_groups SET revision=15,protect_new_inferences=true')
            after = recovery.current_evidence(current)
            self.assertNotEqual(before['controls']['company_information_groups']['sha256'], after['controls']['company_information_groups']['sha256'])
            self.assertNotIn('Synthetic industry', json.dumps(after))
            self.assertNotIn('sensitive chunk', json.dumps(after))
            with self.offline_copy(bundle) as (root, sql):
                recovery.quarantine(sql)
                def fail_commit(query, *args):
                    if 'INSERT INTO company_information_groups(' in query:
                        query = query.replace('COMMIT;', 'SELECT 1/0; COMMIT;')
                    return sql(query, *args)
                with self.assertRaises(trial.TrialError):
                    company.synchronize(fail_commit, current)
                self.assertEqual(sql('SELECT revision FROM company_information_groups'), '2')
                self.assert_guards_enabled(sql)
                self.reopen(sql, current, root)
                self.assertEqual(sql('SELECT revision FROM company_information_groups'), '15')
                with self.assertRaisesRegex(trial.TrialError, '保持隔离'):
                    recovery.coverage(sql)

    def test_service_pause_does_not_permanently_fence_successful_company_information(self):
        self.seed_company()
        bundle = self.snapshot()
        with backup.offline_database(self.source) as (_, __, current):
            current(f"UPDATE tenants SET status='SUSPENDED' WHERE id='{ident(2)}'")
            with self.offline_copy(bundle) as (root, sql):
                recovery.quarantine(sql)
                self.reopen(sql, current, root)
                self.assertEqual(sql('SELECT fenced FROM company_inference_runs'), 'f')
                self.assertEqual(sql(f"SELECT status FROM profile_versions WHERE id='{ident(4001)}'"), 'ACTIVE')
                self.assertEqual(sql(f"SELECT company_profile_readable('{ident(4001)}')"), 'f')
                self.assertEqual(sql(f"SELECT status FROM tenants WHERE id='{ident(2)}'"), 'SUSPENDED')

    def test_accepted_suggestion_does_not_reappear_or_import_missing_target(self):
        self.seed_company()
        with backup.offline_database(self.source) as (_, __, sql):
            sql(f"""INSERT INTO company_information_suggestions(id,tenant_id,run_id,field,label,meaning,state)
              VALUES('{ident(4021)}','{ident(2)}','{ident(4010)}','BUSINESS','Synthetic service','','PENDING');
            INSERT INTO company_suggestion_evidence VALUES('{ident(4021)}','{ident(43)}',0,5);""")
        bundle = self.snapshot()
        with backup.offline_database(self.source) as (_, __, current):
            current(f"""INSERT INTO company_information_groups(tenant_id,field,revision,protect_new_inferences)
              VALUES('{ident(2)}','BUSINESS',1,true);
            INSERT INTO profile_entries(id,tenant_id,scope,entry_key,kind,created_by)
              VALUES('{ident(4003)}','{ident(2)}','TENANT','company.business.new','FACT','{ident(1)}');
            UPDATE company_information_suggestions SET state='APPLIED',target_id='{ident(4003)}',revision=2 WHERE id='{ident(4021)}';""")
            with self.offline_copy(bundle) as (root, sql):
                recovery.quarantine(sql)
                for _ in range(2):
                    result = company.synchronize(sql, current)
                    self.assertEqual(result['unavailableTargets'], 1)
                    self.assertEqual(sql(f"SELECT state||'|'||revision||'|'||(target_id IS NULL) FROM company_information_suggestions WHERE id='{ident(4021)}'"), 'APPLIED|2|true')
                    self.assertEqual(sql(f"SELECT count(*) FROM profile_entries WHERE id='{ident(4003)}'"), '0')
                self.assertEqual(sql("SELECT protect_new_inferences FROM company_information_groups WHERE field='BUSINESS'"), 't')
                self.assert_guards_enabled(sql)

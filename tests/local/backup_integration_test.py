"""Synthetic PG18 only: RUN_BACKUP_DB_TESTS=1 python3 -m unittest discover -s tests/local -p backup_integration_test.py -v"""
from datetime import timedelta
import hashlib
import contextlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
import uuid
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts/local'))
import backup
import backup_recovery
import trial


def ident(number):
    return str(uuid.UUID(int=number))


@unittest.skipUnless(os.environ.get('RUN_BACKUP_DB_TESTS') == '1', 'explicit synthetic PostgreSQL test opt-in')
class RealBackupTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='dreamcore-backup-synthetic-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = backup.reserve(self.root / 'source')
        trial.private_write(self.source / 'config.json', {'format': trial.FORMAT, 'workspace': str(trial.WORKSPACE),
            'ports': {'database': 22001, 'api': 22002, 'web': 22003}})
        trial.private_write(self.source / 'database.json', {'password': 'synthetic-' + str(uuid.uuid4())})
        (self.source / 'objects').mkdir(mode=0o700)
        self.key = self.root / 'keys/signing.json'
        with backup.offline_database(self.source, True) as (run, args, sql):
            sql('CREATE TABLE flyway_schema_history(installed_rank integer PRIMARY KEY,version varchar(50),description varchar(200),type varchar(20),script varchar(1000),checksum integer,installed_by varchar(100),installed_on timestamptz DEFAULT now(),execution_time integer,success boolean)')
            for number, migration in enumerate(backup.migrations(), 1):
                path = trial.WORKSPACE / 'apps/api/src/main/resources/db/migration' / migration['script']
                run([backup.pg('psql'), '-X', *args, '-v', 'ON_ERROR_STOP=1', '-f', str(path)])
                sql(f"INSERT INTO flyway_schema_history(installed_rank,version,script,success) VALUES({number},'{migration['version']}','{migration['script']}',true)")
            self.seed(sql)

    def seed(self, sql):
        a,t,w,p = map(ident, [1,2,3,4])
        sql(f"""INSERT INTO accounts(id,email,display_name,password_hash) VALUES('{a}','synthetic@example.invalid','Synthetic','old-password-hash');
        INSERT INTO platform_roles VALUES('{a}','PLATFORM_ADMIN');
        INSERT INTO tenants(id,name) VALUES('{t}','Synthetic');
        INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES('{t}','{a}','TENANT_ADMIN');
        INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES('{w}','{t}','{a}','Shared','SHARED'),('{p}','{t}','{a}','Private','PERSONAL');
        INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES('{t}','{w}','{a}',true);
        INSERT INTO tenant_governance(tenant_id,owner_id) VALUES('{t}','{a}');
        INSERT INTO governance_capabilities(tenant_id,account_id,workspace_id,capability,granted_by) VALUES('{t}','{a}','{w}','EXPERIENCE_MAINTAIN','{a}');
        INSERT INTO profile_entries(id,tenant_id,scope,entry_key,kind,created_by) VALUES('{ident(70)}','{t}','TENANT','goal','GOAL','{a}');
        INSERT INTO profile_versions(id,tenant_id,entry_id,revision,value,provenance,status,changed_by) VALUES('{ident(71)}','{t}','{ident(70)}',1,'old business goal','explicit','ACTIVE','{a}');
        """)
        for n in (10,20,30):
            body = f'synthetic original {n}'.encode()
            blob = self.source / 'objects' / (ident(n+2) + '.blob')
            blob.write_bytes(body); blob.chmod(0o600)
            sql(f"""BEGIN;
            INSERT INTO materials(id,tenant_id,workspace_id,name,created_by) VALUES('{ident(n)}','{t}','{w}','file-{n}.txt','{a}');
            INSERT INTO material_versions(id,tenant_id,workspace_id,material_id,number,filename,size_bytes,sha256,object_id,created_by)
            VALUES('{ident(n+1)}','{t}','{w}','{ident(n)}',1,'file-{n}.txt',{len(body)},'{hashlib.sha256(body).hexdigest()}','{ident(n+2)}','{a}'); COMMIT;""")
        # Material30 was physically purged before the snapshot; its absent blob must not make create fail.
        sql(f"INSERT INTO content_lifecycle(tenant_id,workspace_id,object_kind,object_id,state) VALUES('{t}','{w}','MATERIAL','{ident(30)}','PURGED')")
        (self.source/'objects'/(ident(32)+'.blob')).unlink()
        conv,task,run,chunk = map(ident,[40,41,42,43])
        sql(f"""INSERT INTO conversations(id,tenant_id,workspace_id,owner_id,title) VALUES('{conv}','{t}','{w}','{a}','synthetic title');
        INSERT INTO conversation_tasks(id,tenant_id,workspace_id,conversation_id,requested_by,prompt,mode,status,attempt,reply)
          VALUES('{task}','{t}','{w}','{conv}','{a}','synthetic question','SOURCE_LOOKUP','RUNNING',1,'sensitive derived response');
        INSERT INTO conversation_attempts(task_id,attempt_number,input,status,provenance,snapshot) VALUES('{task}',1,'sensitive attempt','RUNNING','RECORDED','{{"reply":"sensitive snapshot"}}');
        INSERT INTO knowledge_runs(id,tenant_id,workspace_id,material_id,version_id,generation,requested_by,status) VALUES('{run}','{t}','{w}','{ident(10)}','{ident(11)}',1,'{a}','READY');
        INSERT INTO knowledge_chunks(id,tenant_id,workspace_id,material_id,version_id,run_id,ordinal,locator,method,content) VALUES('{chunk}','{t}','{w}','{ident(10)}','{ident(11)}','{run}',0,'line1','TEXT','sensitive chunk');
        INSERT INTO conversation_agent_grants VALUES('{t}','{w}','{task}','{ident(44)}','{chunk}');
        INSERT INTO task_context_materials VALUES('{task}',1,'{ident(11)}');
        INSERT INTO private_documents(id,tenant_id,owner_id,workspace_id,source_workspace_id,source_conversation_id,source_task_id,revision)
          VALUES('{ident(45)}','{t}','{a}','{p}','{w}','{conv}','{task}',1);
        INSERT INTO private_document_versions(tenant_id,document_id,number,title,body) VALUES('{t}','{ident(45)}',1,'private title','private derived body');
        INSERT INTO document_publications(id,tenant_id,actor_id,document_id,document_version,workspace_id,material_id,material_version_id,material_version,format,filename,sha256)
          VALUES('{ident(46)}','{t}','{a}','{ident(45)}',1,'{w}','{ident(20)}','{ident(21)}',1,'pdf','independent.pdf','{'0'*64}');
        INSERT INTO experience_entries(id,tenant_id,workspace_id,created_by) VALUES('{ident(50)}','{t}','{w}','{a}');
        INSERT INTO experience_versions(id,entry_id,number,content,access_mode,search_terms,tags,created_by) VALUES('{ident(51)}','{ident(50)}',1,'{{"body":"source-bound experience"}}','SOURCE_BOUND','{{}}','{{}}','{a}');
        INSERT INTO experience_evidence(version_id,kind,reference_id,source_workspace_id,task_id) VALUES('{ident(51)}','TASK','{task}','{w}','{task}');
        INSERT INTO experience_uses(id,entry_id,version_id,actor_id,task_id,context_key,decision,adopted,conditions,adjustments) VALUES('{ident(52)}','{ident(50)}','{ident(51)}','{a}','{task}','context','DIRECT',true,'sensitive conditions','sensitive adjustment');
        INSERT INTO experience_feedback(id,use_id,result,note) VALUES('{ident(53)}','{ident(52)}','UNKNOWN','sensitive note');
        INSERT INTO feedback_entries(id,tenant_id,workspace_id,actor_id,kind,task_id,task_revision,attempt,presentation_version,presentation_revision,snapshot)
          VALUES('{ident(60)}','{t}','{w}','{a}','TASK','{task}',0,1,'task-v1',0,'{{"body":"sensitive feedback snapshot"}}');
        INSERT INTO feedback_versions(id,feedback_id,revision,status,assessment) VALUES('{ident(61)}','{ident(60)}',1,'ACTIVE','{{"note":"sensitive feedback"}}');
        INSERT INTO feedback_source_versions VALUES('{ident(60)}','{ident(11)}');
        INSERT INTO task_context_reviews(id,task_id,attempt_number,version_id,request_id,request_hash,decision,conditions,adjustments)
          VALUES('{ident(62)}','{task}',1,'{ident(51)}','{ident(63)}','{'0'*64}','DIRECT','sensitive review','sensitive review');
        INSERT INTO ongoing_plans(id,tenant_id,workspace_id,owner_id,status,goal,purpose,query,behavior,material_events,time_zone,min_interval_seconds,max_runs_per_day,max_total_runs,expires_at)
          VALUES('{ident(80)}','{t}','{w}','{a}','ACTIVE','synthetic goal','purpose','query','SOURCE_LOOKUP',true,'UTC',60,1,10,now()+interval '1 day');
        """)

        self.seed_current_modules(sql)

    def seed_current_modules(self,sql):
        if not backup_recovery.has_table(sql,'export_batches'):return
        a,t,w=map(ident,[1,2,3])
        sql(f"""INSERT INTO export_batches(id,tenant_id,owner_id,workspace_id,scope,retention_days,state,requested_count,generation,bytes,generated_at,expires_at)
          VALUES('{ident(100)}','{t}','{a}','{w}','ENTERPRISE',7,'READY',1,'{ident(101)}',3,now(),now()+interval '7 days');
        INSERT INTO export_batch_items(batch_id,ordinal,object_id,version,format,state,title,archive_path) VALUES('{ident(100)}',1,'{ident(20)}',1,'pdf','INCLUDED','export title','old.pdf');
        INSERT INTO export_archive_chunks VALUES('{ident(100)}','{ident(101)}',0,decode('6f6c64','hex'));
        INSERT INTO evaluation_assets(id,kind,created_by) VALUES('{ident(110)}','STANDARD','{a}'),('{ident(112)}','SAMPLE','{a}');
        INSERT INTO evaluation_asset_versions(id,asset_id,revision,content,evidence,origin_key,mode,created_by)
          VALUES('{ident(111)}','{ident(110)}',1,'{{"title":"standard"}}','{{"items":[]}}','synthetic-standard','SYNTHETIC','{a}'),
          ('{ident(113)}','{ident(112)}',1,'{{"body":"source-dependent sample"}}','{{"items":[]}}','synthetic-sample','SYNTHETIC','{a}');
        INSERT INTO evaluation_source_versions VALUES('{ident(113)}','{ident(11)}');
        INSERT INTO method_families(id,kind,title,created_by) VALUES('{ident(120)}','RANKING_V1','Synthetic method','{a}');
        INSERT INTO method_versions(id,family_id,number,configuration,configuration_sha,compatibility,rationale,created_by)
          VALUES('{ident(121)}','{ident(120)}',1,'{{"relevanceWeight":0.55,"recencyWeight":0.25,"importanceWeight":0.2}}','{'0'*64}','ranking-v1','synthetic','{a}');
        INSERT INTO method_comparisons(id,candidate_version,standard_version,sample_versions,results,created_by)
          VALUES('{ident(122)}','{ident(121)}','{ident(111)}','{{"items":["{ident(113)}"]}}','{{"items":[]}}','{a}');
        INSERT INTO method_releases VALUES('{ident(121)}','{ident(122)}','{a}',now());
        UPDATE method_families SET head_version='{ident(121)}',published_version='{ident(121)}' WHERE id='{ident(120)}';
        INSERT INTO method_adoptions(id,tenant_id,revision,status,version_id,actor_id) VALUES('{ident(123)}','{t}',1,'ACTIVE','{ident(121)}','{a}');
        INSERT INTO recommendation_settings(tenant_id,actor_id,enabled) VALUES('{t}','{a}',true);
        """)

    def test_phone_accounts_restore_with_new_credentials_and_no_verification_proofs(self):
        with backup.offline_database(self.source) as (_,__,sql):
            sql(f"UPDATE accounts SET email=NULL,phone='+8619900009901',phone_verified_at=now() WHERE id='{ident(1)}'")
            sql(f"INSERT INTO phone_challenges(id,phone,purpose,session_hash,account_id,code_hash,expires_at,verified_at) VALUES('{ident(900)}','+8619900009901','RESET','{'0'*64}','{ident(1)}','synthetic-only',now()+interval '5 minutes',now())")
        bundle,restored=self.root/'phone-bundle',self.root/'phone-restored'
        backup.create(self.source,bundle,self.key)
        self.assertNotIn('phone_challenges',backup.verify(bundle,self.key)['tables'])
        backup.restore(bundle,restored,self.key)
        with backup.offline_database(restored) as (_,__,sql):
            self.assertEqual(sql('SELECT count(*) FROM phone_challenges'),'0')
            self.assertEqual(sql(f"SELECT status||':'||credential_version FROM accounts WHERE id='{ident(1)}'"),'DISABLED:1')
        backup_recovery.activate(restored,self.source,self.key)
        credentials=trial.private_read(restored/'accounts.json')['recovered']
        account=next(row for row in credentials if row['accountId']==ident(1))
        self.assertEqual(account['phone'],'+8619900009901');self.assertIsNone(account['email'])
        with backup.offline_database(restored) as (_,__,sql):
            self.assertEqual(sql(f"SELECT status FROM accounts WHERE id='{ident(1)}'"),'ACTIVE')
            self.assertGreater(int(sql(f"SELECT credential_version FROM accounts WHERE id='{ident(1)}'")),1)
            self.assertEqual(sql('SELECT count(*) FROM phone_challenges'),'0')

    def test_changed_phone_cannot_reopen_snapshot_identity(self):
        with backup.offline_database(self.source) as (_,__,sql):
            sql(f"UPDATE accounts SET phone='+8619900009901',phone_verified_at=now() WHERE id='{ident(1)}'")
        bundle,restored=self.root/'phone-bundle',self.root/'phone-restored'
        backup.create(self.source,bundle,self.key);backup.restore(bundle,restored,self.key)
        with backup.offline_database(self.source) as (_,__,sql):
            sql(f"UPDATE accounts SET phone='+8619900009902' WHERE id='{ident(1)}'")
        result=backup_recovery.activate(restored,self.source,self.key)
        self.assertEqual(result['accountsEnabled'],0)
        with backup.offline_database(restored) as (_,__,sql):
            self.assertEqual(sql(f"SELECT status FROM accounts WHERE id='{ident(1)}'"),'DISABLED')

    def test_real_create_restore_current_deletion_revocation_rotation(self):
        bundles = backup.reserve(self.root/'bundles')
        bundle = bundles/'first'
        backup.create(self.source,bundle,self.key)
        manifest = backup.verify(bundle,self.key)
        self.assertEqual(manifest['migrations'],backup.migrations())
        self.assertNotIn('objects/'+ident(32)+'.blob',manifest['files'])
        restored = self.root/'restored'
        result = backup.restore(bundle,restored,self.key)
        self.assertEqual(result['status'],'restored_quarantined')
        with self.assertRaises(trial.TrialError): trial.start(restored)
        with backup.offline_database(restored) as (_,__,sql):
            self.assertEqual(sql("SELECT reply FROM conversation_tasks"),'sensitive derived response')
            self.assertEqual(sql("SELECT status FROM conversation_tasks"),'RESULT_UNKNOWN')
            self.assertEqual(sql("SELECT status FROM ongoing_plans"),'PAUSED')
            self.assertEqual(sql("SELECT count(*) FROM workspace_members"),'0')
            self.assertEqual(sql("SELECT count(*) FROM accounts WHERE status='ACTIVE'"),'0')
        # After the snapshot: revoke membership, change business goal and purge its original.
        with backup.offline_database(self.source) as (_,__,sql):
            sql(f"DELETE FROM workspace_members; UPDATE profile_versions SET value='new current goal'; UPDATE accounts SET status='DISABLED'; INSERT INTO content_lifecycle(tenant_id,workspace_id,object_kind,object_id,state) VALUES('{ident(2)}','{ident(3)}','MATERIAL','{ident(10)}','PURGED')")
        (self.source/'objects'/(ident(12)+'.blob')).unlink()
        result = backup_recovery.reconcile(restored,self.source,self.key)
        self.assertEqual(result['status'],'current_state_checked_quarantined')
        self.assertIn('accounts',result['changedControlTables'])
        self.assertIn('profile_versions',result['changedControlTables'])
        self.assertFalse((restored/'objects'/(ident(12)+'.blob')).exists())
        self.assertEqual((restored/'objects'/(ident(22)+'.blob')).read_bytes(),b'synthetic original 20')
        with backup.offline_database(restored) as (_,__,sql):
            for query in ["SELECT coalesce(reply,'') FROM conversation_tasks",'SELECT body FROM private_document_versions','SELECT conditions FROM experience_uses','SELECT note FROM experience_feedback','SELECT conditions FROM task_context_reviews','SELECT content FROM knowledge_chunks']:
                self.assertEqual(sql(query),'',query)
            self.assertEqual(sql('SELECT content::text FROM experience_versions'),'{}')
            self.assertEqual(sql('SELECT snapshot::text FROM feedback_entries'),'{}')
            self.assertEqual(sql('SELECT snapshot::text FROM conversation_attempts'),'{}')
            self.assertEqual(sql('SELECT count(*) FROM document_publications'),'1')
            self.assertEqual(sql("SELECT content::text FROM evaluation_asset_versions WHERE id='"+ident(113)+"'"),'{}')
            self.assertEqual(sql('SELECT count(*) FROM export_archive_chunks'),'0')
            self.assertEqual(sql("SELECT count(*) FROM profile_versions WHERE status='ACTIVE'"),'0')
        evidence = backup.signed_read(restored/'current-state-evidence.json',backup.signing_key(self.key))
        self.assertTrue(evidence['allAuthorizationClosed'])
        self.assertFalse(evidence['automaticOldTaskExecutionEnabled'])
        # A second reconciliation is safe and an isolated copy cannot be promoted to authority.
        backup_recovery.reconcile(restored,self.source,self.key)
        with self.assertRaises(trial.TrialError): backup.create(restored,bundles/'laundered',self.key)
        with self.assertRaises(trial.TrialError): backup_recovery.reconcile(restored,restored,self.key)
        backup.repack(bundle,bundles/'copy',self.key)
        self.assertEqual(backup.verify(bundles/'copy',self.key)['createdAt'],manifest['createdAt'])
        with patch.object(backup,'now',return_value=backup.datetime.fromisoformat(manifest['expiresAt'])):
            with self.assertRaises(trial.TrialError): backup.restore(bundle,self.root/'expired',self.key)
            self.assertEqual(len(backup.rotate(bundles,self.key)['removed']),2)
            with self.assertRaises(trial.TrialError):backup_recovery.activate(restored,self.source,self.key)
            self.assertTrue(backup_recovery.rotate_pending(restored,self.key))
            self.assertFalse(restored.exists())

    def test_activate_uses_fresh_authority_and_new_credentials(self):
        bundle,restored=self.root/'bundle',self.root/'restored'
        backup.create(self.source,bundle,self.key);backup.restore(bundle,restored,self.key)
        backup_recovery.reconcile(restored,self.source,self.key)
        # A grant revoked AFTER reconciliation still must not reopen during activation.
        with backup.offline_database(self.source) as (_,__,sql): sql("DELETE FROM workspace_members; UPDATE recommendation_settings SET enabled=false; UPDATE method_adoptions SET status='STOPPED'")
        result=backup_recovery.activate(restored,self.source,self.key)
        self.assertEqual(result['accountsEnabled'],1)
        self.assertEqual(result['sharedGrantsEnabled'],0)
        self.assertEqual(result['effectiveConfigurations']['profiles'],1)
        self.assertEqual(result['effectiveConfigurations']['methodAdoptions'],0)
        backup_recovery.require_activation(restored)
        credentials=trial.private_read(restored/'accounts.json')['recovered']
        self.assertEqual(credentials[0]['accountId'],ident(1))
        with backup.offline_database(restored) as (_,__,sql):
            self.assertEqual(sql("SELECT status FROM accounts WHERE id='"+ident(1)+"'"),'ACTIVE')
            self.assertEqual(sql('SELECT count(*) FROM workspace_members'),'0')
            self.assertEqual(sql('SELECT count(*) FROM export_archive_chunks'),'0')
            self.assertEqual(sql('SELECT state FROM export_batches'),'REVOKED')
            self.assertEqual(sql('SELECT enabled FROM recommendation_settings'),'f')
            self.assertEqual(sql('SELECT status FROM method_adoptions'),'STOPPED')
            self.assertEqual(sql('SELECT status FROM ongoing_plans'),'PAUSED')
            self.assertEqual(sql('SELECT status FROM conversation_tasks'),'RESULT_UNKNOWN')
            encoded=sql("SELECT password_hash FROM accounts WHERE id='"+ident(1)+"'")
            packed=bytes.fromhex(encoded.split('}',1)[1])
            self.assertEqual(hashlib.pbkdf2_hmac('sha256',credentials[0]['password'].encode(),packed[:16],600_000,32),packed[16:])
            self.assertNotEqual(hashlib.pbkdf2_hmac('sha256',b'old-password',packed[:16],600_000,32),packed[16:])
        new_bundle=self.root/'new-operational-snapshot'
        backup.create(restored,new_bundle,self.key)
        self.assertNotEqual(backup.verify(new_bundle,self.key)['sourceInstanceId'],backup.verify(bundle,self.key)['sourceInstanceId'])
        with self.assertRaises(trial.TrialError):backup_recovery.activate(restored,self.source,self.key)
        signed=trial.private_read(restored/'restore.json');signed['manifest']['activationDirectory']='/wrong'
        trial.private_write(restored/'restore.json',signed)
        with self.assertRaises(trial.TrialError):backup_recovery.require_activation(restored)

    @unittest.skipUnless(os.environ.get('RUN_BACKUP_HTTP_TESTS')=='1','requires compiled current API classes and Maven dependency report')
    def test_activated_application_login_and_authorized_download(self):
        bundle,restored=self.root/'bundle',self.root/'restored'
        backup.create(self.source,bundle,self.key);backup.restore(bundle,restored,self.key)
        with backup.offline_database(self.source) as (_,__,sql):
            sql(f"INSERT INTO content_lifecycle(tenant_id,workspace_id,object_kind,object_id,state) VALUES('{ident(2)}','{ident(3)}','MATERIAL','{ident(10)}','PURGED')")
        (self.source/'objects'/(ident(12)+'.blob')).unlink()
        backup_recovery.activate(restored,self.source,self.key)
        credentials=trial.private_read(restored/'accounts.json')['recovered'][0]
        import urllib.error
        with self.http(restored) as (url,browser,post):
            with self.assertRaises(urllib.error.HTTPError) as rejected:post(browser(),'/api/v1/auth/login',{'email':credentials['email'],'password':'old-password'})
            self.assertEqual(rejected.exception.code,401);rejected.exception.close()
            client=browser();self.assertEqual(post(client,'/api/v1/auth/login',{'email':credentials['email'],'password':credentials['password']}).status,200)
            base=url+f'/api/v1/tenants/{ident(2)}/workspaces/{ident(3)}/materials/'
            self.assertEqual(client.open(base+ident(20)+'/versions/'+ident(21)+'/download').read(),b'synthetic original 20')
            with self.assertRaises(urllib.error.HTTPError) as missing:client.open(base+ident(10)+'/versions/'+ident(11)+'/download')
            self.assertEqual(missing.exception.code,404);missing.exception.close()

    @contextlib.contextmanager
    def http(self,restored):
        import http.cookiejar,subprocess,time,urllib.request,urllib.error,xml.etree.ElementTree as ET
        report=trial.WORKSPACE/'apps/api/target/surefire-reports/TEST-com.dreamcore.workspace.TaskContextIntegrationTest.xml'
        properties={x.attrib['name']:x.attrib.get('value','') for x in ET.parse(report).getroot().findall('./properties/property')}
        classpath=properties['java.class.path']
        self.assertIn(str(trial.WORKSPACE/'apps/api/target/classes'),classpath)
        port,apiport=trial.free_port(),trial.free_port()
        database_secret=trial.private_read(restored/'database.json')['password']
        env={**trial.clean_environment(),'DATABASE_URL':f'jdbc:postgresql://127.0.0.1:{port}/dreamcore_trial',
             'DATABASE_USER':'dreamcore_trial','DATABASE_PASSWORD':database_secret,'API_HOST':'127.0.0.1','API_PORT':str(apiport),
             'SPRING_FLYWAY_ENABLED':'false','SPRING_PROFILES_ACTIVE':'local','SPRING_MAIN_BANNER_MODE':'off','DREAMCORE_LIFECYCLE_ENABLED':'false',
             'DREAMCORE_DEPARTURE_WORKER_ENABLED':'false','DREAMCORE_OPERATIONS_RETENTION_ENABLED':'false','TASK_ENABLED':'false','KNOWLEDGE_ENABLED':'false','MATERIAL_STORAGE_ROOT':str(restored/'objects')}
        with tempfile.TemporaryDirectory(prefix='dreamcore-recovery-http-') as socketdir:
            with (self.root/'synthetic-api.log').open('w') as log:
                subprocess.run([backup.pg('pg_ctl'),'-D',str(restored/'postgres'),'-l',str(self.root/'synthetic-pg.log'),'-o',f'-h 127.0.0.1 -p {port} -k {socketdir}','-w','start'],env=trial.clean_environment(),stdout=log,stderr=log,check=True)
                process=None
                try:
                    process=subprocess.Popen(['java','-cp',classpath,'com.dreamcore.workspace.WorkspaceApplication'],cwd=trial.WORKSPACE,env=env,stdout=log,stderr=log)
                    url=f'http://127.0.0.1:{apiport}'
                    for _ in range(200):
                        if process.poll() is not None:self.fail('Synthetic API startup failed; inspect the test-only log')
                        try:
                            urllib.request.urlopen(url+'/api/v1/auth/csrf',timeout=.5).close();break
                        except (urllib.error.URLError,TimeoutError):time.sleep(.1)
                    else:self.fail('Synthetic API startup timed out')
                    def browser():return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
                    def post(client,path,body):
                        csrf=json.load(client.open(url+'/api/v1/auth/csrf'))
                        return client.open(urllib.request.Request(url+path,data=json.dumps(body).encode(),headers={'Content-Type':'application/json',csrf['headerName']:csrf['token']}))
                    yield url,browser,post
                finally:
                    if process:
                        process.terminate()
                        try:process.wait(timeout=20)
                        except subprocess.TimeoutExpired:process.kill();process.wait()
                    subprocess.run([backup.pg('pg_ctl'),'-D',str(restored/'postgres'),'-m','fast','-w','stop'],env=trial.clean_environment(),stdout=log,stderr=log,check=True)

    def test_changed_private_owner_cannot_reopen_old_owner(self):
        bundle,restored=self.root/'bundle',self.root/'restored'
        backup.create(self.source,bundle,self.key);backup.restore(bundle,restored,self.key)
        with backup.offline_database(self.source) as (_,__,sql):
            sql(f"INSERT INTO accounts(id,email,display_name,password_hash) VALUES('{ident(90)}','new@example.invalid','New','new-hash'); INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES('{ident(2)}','{ident(90)}','MEMBER'); UPDATE workspaces SET owner_id='{ident(90)}' WHERE id='{ident(4)}'")
        result=backup_recovery.activate(restored,self.source,self.key)
        self.assertEqual(result['privateOwnersHeld'],1)
        with backup.offline_database(restored) as (_,__,sql):
            self.assertEqual(sql("SELECT status FROM accounts WHERE id='"+ident(1)+"'"),'DISABLED')
            self.assertEqual(sql("SELECT count(*) FROM tenant_memberships WHERE status='ACTIVE'"),'0')
            self.assertEqual(sql('SELECT count(*) FROM platform_roles'),'1')
        creds=trial.private_read(restored/'accounts.json')
        self.assertTrue(creds['platform']['localRecoveryPlatformOnly'])

    def test_current_lifecycle_overrides_old_deadline_and_deleted_ancestor(self):
        with backup.offline_database(self.source) as (_,__,sql):
            sql(f"INSERT INTO material_folders(id,tenant_id,workspace_id,name,created_by) VALUES('{ident(200)}','{ident(2)}','{ident(3)}','old folder','{ident(1)}'); UPDATE materials SET folder_id='{ident(200)}' WHERE id='{ident(10)}'; INSERT INTO content_lifecycle(tenant_id,workspace_id,object_kind,object_id,state,purge_after) VALUES('{ident(2)}','{ident(3)}','MATERIAL','{ident(20)}','TRASHED',now()-interval '1 day')")
        bundle,restored=self.root/'bundle',self.root/'restored'
        backup.create(self.source,bundle,self.key)
        with backup.offline_database(self.source) as (_,__,sql):
            sql(f"UPDATE content_lifecycle SET state='ACTIVE',purge_after=NULL WHERE object_kind='MATERIAL' AND object_id='{ident(20)}'; INSERT INTO content_lifecycle(tenant_id,workspace_id,object_kind,object_id,state) VALUES('{ident(2)}','{ident(3)}','FOLDER','{ident(200)}','PURGED')")
        (self.source/'objects'/(ident(12)+'.blob')).unlink()
        backup.restore(bundle,restored,self.key)
        backup_recovery.activate(restored,self.source,self.key)
        with backup.offline_database(restored) as (_,__,sql):
            self.assertEqual(sql(f"SELECT state||':'||(purge_after IS NULL)::text FROM content_lifecycle WHERE object_kind='MATERIAL' AND object_id='{ident(20)}'"),'ACTIVE:true')
            self.assertEqual(sql(f"SELECT count(*) FROM active_materials WHERE id='{ident(20)}'"),'1')
            self.assertEqual(sql(f"SELECT state FROM content_lifecycle WHERE object_kind='MATERIAL' AND object_id='{ident(10)}'"),'PURGED')
            self.assertEqual(sql('SELECT status FROM method_adoptions'),'ACTIVE')
        self.assertFalse((restored/'objects'/(ident(12)+'.blob')).exists())
        self.assertTrue((restored/'objects'/(ident(22)+'.blob')).exists())

    def test_current_method_adoption_is_not_a_new_adoption(self):
        bundle,restored=self.root/'bundle',self.root/'restored'
        backup.create(self.source,bundle,self.key)
        with backup.offline_database(self.source) as (_,__,sql):
            # A later standard revision blocks NEW adopt in the API, but does not revoke this effective adoption.
            sql(f"UPDATE evaluation_assets SET revision=2 WHERE id='{ident(110)}'; INSERT INTO evaluation_asset_versions(id,asset_id,revision,content,evidence,origin_key,mode,created_by) VALUES('{ident(114)}','{ident(110)}',2,'{{\"title\":\"current standard\"}}','{{\"items\":[]}}','synthetic-standard-v2','SYNTHETIC','{ident(1)}')")
        backup.restore(bundle,restored,self.key)
        result=backup_recovery.activate(restored,self.source,self.key)
        self.assertEqual(result['effectiveConfigurations']['methodAdoptions'],1)
        with backup.offline_database(restored) as (_,__,sql):
            self.assertEqual(sql('SELECT status FROM method_adoptions'),'ACTIVE')
            self.assertEqual(sql(f"SELECT status FROM evaluation_assets WHERE id='{ident(110)}'"),'WITHDRAWN')

    def test_retention_preparation_uses_current_facts_without_exiting(self):
        with backup.offline_database(self.source) as (_,__,sql):
            self.assertTrue(backup_recovery.has_table(sql,'retention_cases'))
            sql(f"""INSERT INTO retention_policy_versions VALUES('{ident(140)}','{ident(2)}','EXPORT_PACKAGE',1,7,'synthetic','{ident(1)}',now());
            INSERT INTO retention_cases(id,tenant_id,kind,label,state,created_by,created_at,changed_at)
              VALUES('{ident(141)}','{ident(2)}','TENANT_EXIT','synthetic preparation','DRAFT','{ident(1)}',now(),now());
            INSERT INTO retention_case_versions VALUES('{ident(141)}',1,'DRAFT','CREATE','{{}}',NULL,'{ident(1)}',now());
            INSERT INTO retention_case_scopes VALUES('{ident(141)}','{ident(2)}','{ident(3)}');""")
        bundle,restored=self.root/'bundle',self.root/'restored'
        backup.create(self.source,bundle,self.key)
        with backup.offline_database(self.source) as (_,__,sql):
            sql(f"""INSERT INTO retention_policy_versions VALUES('{ident(142)}','{ident(2)}','EXPORT_PACKAGE',2,14,'future only','{ident(1)}',now());
            UPDATE retention_cases SET state='ASSESSED',revision=2,changed_at=now() WHERE id='{ident(141)}';
            INSERT INTO retention_case_versions VALUES('{ident(141)}',2,'ASSESSED','ASSESS','{{}}','{{"ready":true}}','{ident(1)}',now());""")
        backup.restore(bundle,restored,self.key)
        result=backup_recovery.activate(restored,self.source,self.key)
        self.assertEqual(result['heldTenantIds'],[])
        with backup.offline_database(restored) as (_,__,sql):
            self.assertEqual(sql('SELECT state FROM retention_cases'),'ASSESSED')
            self.assertEqual(sql('SELECT days FROM retention_policy_versions ORDER BY revision DESC LIMIT 1'),'14')
            self.assertEqual(sql('SELECT count(*) FROM retention_case_versions'),'2')
            self.assertEqual(sql('SELECT status FROM tenants'),'ACTIVE')
            self.assertEqual(sql('SELECT status FROM tenant_memberships'),'ACTIVE')
            self.assertEqual(sql(f"SELECT count(*) FROM active_materials WHERE id='{ident(20)}'"),'1')
        # A current cancellation is a preparation fact too; no old ASSESSED state is replayed.
        with backup.offline_database(self.source) as (_,__,sql):
            sql(f"UPDATE retention_cases SET state='CANCELLED',revision=3 WHERE id='{ident(141)}'; INSERT INTO retention_case_versions VALUES('{ident(141)}',3,'CANCELLED','CANCEL','{{}}',NULL,'{ident(1)}',now())")
        second=self.root/'second-restored'
        backup.restore(bundle,second,self.key);backup_recovery.activate(second,self.source,self.key)
        with backup.offline_database(second) as (_,__,sql):
            self.assertEqual(sql('SELECT state FROM retention_cases'),'CANCELLED')
            self.assertEqual(sql('SELECT count(*) FROM retention_case_versions'),'3')
            self.assertEqual(sql('SELECT status FROM tenants'),'ACTIVE')

    def test_unmapped_current_retention_actor_holds_tenant(self):
        bundle,restored=self.root/'bundle',self.root/'restored'
        backup.create(self.source,bundle,self.key)
        with backup.offline_database(self.source) as (_,__,sql):
            sql(f"INSERT INTO accounts(id,email,display_name,password_hash) VALUES('{ident(150)}','later@example.invalid','Later','hash'); INSERT INTO retention_policy_versions VALUES('{ident(151)}','{ident(2)}','EXPORT_PACKAGE',1,7,'current actor unavailable in snapshot','{ident(150)}',now())")
        backup.restore(bundle,restored,self.key)
        result=backup_recovery.activate(restored,self.source,self.key)
        self.assertEqual(result['heldTenantIds'],[ident(2)])
        with backup.offline_database(restored) as (_,__,sql):
            self.assertEqual(sql('SELECT status FROM tenants'),'SUSPENDED')
            self.assertEqual(sql('SELECT status FROM tenant_memberships'),'DISABLED')
            self.assertEqual(sql('SELECT count(*) FROM workspace_members'),'0')

    def test_governance_versions_and_withdrawn_initial_designation_do_not_rewind(self):
        with backup.offline_database(self.source) as (_,__,sql):
            sql(f"""INSERT INTO invitations(id,tenant_id,email,role,token_hash,status,expires_at,created_by,accepted_by)
              VALUES('{ident(170)}','{ident(2)}','synthetic@example.invalid','TENANT_ADMIN','{'a'*64}','ACCEPTED',now()+interval '1 day','{ident(1)}','{ident(1)}');
            INSERT INTO governance_initial_designations(tenant_id,invitation_id,designated_by) VALUES('{ident(2)}','{ident(170)}','{ident(1)}');""")
        bundle,restored=self.root/'bundle',self.root/'restored'
        backup.create(self.source,bundle,self.key)
        with backup.offline_database(self.source) as (_,__,sql):
            sql('DELETE FROM governance_initial_designations; UPDATE tenant_governance SET owner_id=NULL,revision=9; UPDATE tenants SET management_version=8; UPDATE tenant_memberships SET management_version=7; UPDATE workspaces SET management_version=6')
        backup.restore(bundle,restored,self.key);backup_recovery.activate(restored,self.source,self.key)
        with backup.offline_database(restored) as (_,__,sql):
            self.assertEqual(sql('SELECT count(*) FROM governance_initial_designations'),'0')
            self.assertEqual(sql('SELECT revision FROM tenant_governance'),'9')
            self.assertEqual(sql('SELECT owner_id IS NULL FROM tenant_governance'),'t')
            self.assertEqual(sql('SELECT management_version FROM tenants'),'8')
            self.assertEqual(sql('SELECT management_version FROM tenant_memberships'),'7')
            self.assertEqual(sql('SELECT min(management_version) FROM workspaces'),'6')

    def test_retention_boundaries_keep_actual_anchor_and_policy_version(self):
        a,t,w=map(ident,[1,2,3])
        with backup.offline_database(self.source) as (_,__,sql):
            sql(f"""INSERT INTO retention_policy_versions VALUES('{ident(180)}','{t}','TRASH',1,30,'first policy','{a}',now());
            INSERT INTO content_lifecycle(tenant_id,workspace_id,object_kind,object_id,state,trashed_at,purge_after,retention_policy_revision)
              VALUES('{t}','{w}','MATERIAL','{ident(20)}','TRASHED',now()-interval '2 days',now()+interval '28 days',1);
            UPDATE export_batches SET retention_policy_revision=1,retention_anchor=now()-interval '2 days',retention_deadline=now()+interval '5 days';""")
        bundle,restored=self.root/'bundle',self.root/'restored'
        backup.create(self.source,bundle,self.key)
        with backup.offline_database(self.source) as (_,__,sql):
            sql(f"""INSERT INTO retention_policy_versions VALUES('{ident(181)}','{t}','TRASH',2,10,'new objects only','{a}',now());
            INSERT INTO content_lifecycle(tenant_id,workspace_id,object_kind,object_id,state,trashed_at,purge_after,retention_policy_revision)
              VALUES('{t}','{w}','MATERIAL','{ident(10)}','TRASHED',now(),now()+interval '10 days',2);""")
            expected=sql("SELECT object_id::text||':'||trashed_at::text||':'||purge_after::text||':'||retention_policy_revision::text FROM content_lifecycle WHERE state='TRASHED' ORDER BY object_id")
            export=sql('SELECT retention_anchor::text||retention_deadline::text||retention_policy_revision::text FROM export_batches')
        backup.restore(bundle,restored,self.key);backup_recovery.activate(restored,self.source,self.key)
        with backup.offline_database(restored) as (_,__,sql):
            self.assertEqual(sql("SELECT object_id::text||':'||trashed_at::text||':'||purge_after::text||':'||retention_policy_revision::text FROM content_lifecycle WHERE state='TRASHED' ORDER BY object_id"),expected)
            self.assertEqual(sql('SELECT retention_anchor::text||retention_deadline::text||retention_policy_revision::text FROM export_batches'),export)
            self.assertEqual(sql('SELECT count(*) FROM export_archive_chunks'),'0')

    def test_current_object_purge_removes_old_bytes_but_keeps_independent_publication(self):
        bundle,restored=self.root/'bundle',self.root/'restored'
        backup.create(self.source,bundle,self.key)
        with backup.offline_database(self.source) as (_,__,sql):
            sql(f"SELECT scrub_lifecycle_object('TASK','{ident(41)}')")
        backup.restore(bundle,restored,self.key);backup_recovery.activate(restored,self.source,self.key)
        with backup.offline_database(restored) as (_,__,sql):
            self.assertEqual(sql('SELECT coalesce(reply,\'\') FROM conversation_tasks'),'')
            self.assertEqual(sql('SELECT body FROM private_document_versions'),'')
            self.assertEqual(sql(f"SELECT state FROM object_lifecycle WHERE kind='TASK' AND object_id='{ident(41)}'"),'PURGED')
            self.assertEqual(sql(f"SELECT object_is_active('TASK','{ident(41)}')"),'f')
            self.assertEqual(sql('SELECT count(*) FROM document_publications'),'1')
        self.assertEqual((restored/'objects'/(ident(22)+'.blob')).read_bytes(),b'synthetic original 20')

    def publication_feedback_fixture(self,sql):
        # A second person reads only the independent publication, not its author's private task.
        a,t,w,p,f,v=map(ident,[301,2,3,302,303,304])
        sql(f"""INSERT INTO accounts(id,email,display_name,password_hash) VALUES('{a}','reader@example.invalid','Reader','old-reader-hash');
        INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES('{t}','{a}','MEMBER');
        INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES('{p}','{t}','{a}','Reader private','PERSONAL');
        INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES('{t}','{w}','{a}',false);
        INSERT INTO recommendation_presentations(tenant_id,actor_id,task_id,task_revision,attempt,fingerprint,method,presentation,settings_revision,publication_id,material_version_id)
          VALUES('{t}','{a}',NULL,0,0,'{'a'*64}','{{}}','{{}}',0,'{ident(46)}','{ident(21)}');
        INSERT INTO feedback_entries(id,tenant_id,workspace_id,actor_id,kind,task_id,task_revision,attempt,presentation_version,presentation_revision,snapshot,publication_id,material_version_id,material_version)
          VALUES('{f}','{t}','{w}','{a}','PUBLICATION',NULL,0,0,'recommendation-v1',(SELECT max(id) FROM recommendation_presentations),
          '{{"taskState":"PUBLISHED","executionClass":"none","contentSha256":"{'0'*64}","sourceVersionCount":1}}','{ident(46)}','{ident(21)}',1);
        INSERT INTO feedback_versions(id,feedback_id,revision,status,assessment) VALUES('{v}','{f}',1,'ACTIVE','{{"rating":"USEFUL","reasons":[],"suggestion":"private reader opinion"}}');
        INSERT INTO feedback_source_versions VALUES('{f}','{ident(21)}');
        INSERT INTO conversations(id,tenant_id,workspace_id,owner_id,title) VALUES('{ident(305)}','{t}','{p}','{a}','reader correction');
        INSERT INTO conversation_tasks(id,tenant_id,workspace_id,conversation_id,requested_by,prompt,mode,status,attempt,reply)
          VALUES('{ident(306)}','{t}','{p}','{ident(305)}','{a}','private correction','SOURCE_LOOKUP','SUCCEEDED',1,'private correction body');
        INSERT INTO feedback_task_sources VALUES('{ident(306)}','{ident(21)}','{f}');
        INSERT INTO experience_entries(id,tenant_id,workspace_id,created_by) VALUES('{ident(307)}','{t}','{p}','{a}');
        INSERT INTO experience_versions(id,entry_id,number,content,access_mode,search_terms,tags,created_by)
          VALUES('{ident(308)}','{ident(307)}',1,'{{"body":"reader candidate body"}}','SOURCE_BOUND','{{}}','{{}}','{a}');
        INSERT INTO experience_evidence(version_id,kind,reference_id,source_workspace_id,material_version_id) VALUES('{ident(308)}','MATERIAL_VERSION','{ident(21)}','{w}','{ident(21)}');
        INSERT INTO profile_entries(id,tenant_id,scope,account_id,entry_key,kind,created_by) VALUES('{ident(309)}','{t}','PERSONAL','{a}','presentation-preference','PREFERENCE','{a}');
        INSERT INTO profile_versions(id,tenant_id,entry_id,revision,value,provenance,status,changed_by)
          VALUES('{ident(310)}','{t}','{ident(309)}',1,'CONCLUSION_FIRST','independently selected enum','ACTIVE','{a}');
        """)

    def test_publication_feedback_survives_original_task_purge(self):
        with backup.offline_database(self.source) as (_,__,sql):self.publication_feedback_fixture(sql)
        bundle,restored=self.root/'bundle',self.root/'restored'
        backup.create(self.source,bundle,self.key)
        with backup.offline_database(self.source) as (_,__,sql):sql(f"SELECT scrub_lifecycle_object('TASK','{ident(41)}')")
        backup.restore(bundle,restored,self.key);backup_recovery.activate(restored,self.source,self.key)
        with backup.offline_database(restored) as (_,__,sql):
            self.assertEqual(sql(f"SELECT count(*) FROM readable_feedback WHERE id='{ident(303)}'"),'1')
            self.assertEqual(sql(f"SELECT assessment->>'suggestion' FROM feedback_versions WHERE id='{ident(304)}'"),'private reader opinion')
            self.assertEqual(sql(f"SELECT parent_kind IS NULL AND parent_id IS NULL AND owner_id='{ident(301)}'::uuid FROM lifecycle_object_sources WHERE kind='FEEDBACK_VERSION' AND object_id='{ident(304)}'"),'t')
            self.assertEqual(sql(f"SELECT reply FROM conversation_tasks WHERE id='{ident(306)}'"),'private correction body')
            self.assertEqual(sql(f"SELECT content->>'body' FROM experience_versions WHERE id='{ident(308)}'"),'reader candidate body')
            self.assertEqual(sql(f"SELECT count(*) FROM readable_source_tasks WHERE id='{ident(306)}'"),'1')

    def test_current_publication_deletion_scrubs_reader_feedback_and_derivatives(self):
        with backup.offline_database(self.source) as (_,__,sql):self.publication_feedback_fixture(sql)
        bundle,restored=self.root/'bundle',self.root/'restored'
        backup.create(self.source,bundle,self.key)
        with backup.offline_database(self.source) as (_,__,sql):
            sql(f"INSERT INTO content_lifecycle(tenant_id,workspace_id,object_kind,object_id,state) VALUES('{ident(2)}','{ident(3)}','MATERIAL','{ident(20)}','PURGED')")
            sql(f"SELECT scrub_feedback_material('{ident(20)}'); SELECT scrub_experience_material('{ident(20)}')")
        (self.source/'objects'/(ident(22)+'.blob')).unlink()
        backup.restore(bundle,restored,self.key);backup_recovery.activate(restored,self.source,self.key)
        with backup.offline_database(restored) as (_,__,sql):
            self.assertEqual(sql(f"SELECT count(*) FROM readable_feedback WHERE id='{ident(303)}'"),'0')
            self.assertEqual(sql(f"SELECT assessment::text FROM feedback_versions WHERE id='{ident(304)}'"),'{}')
            self.assertEqual(sql(f"SELECT coalesce(reply,'') FROM conversation_tasks WHERE id='{ident(306)}'"),'')
            self.assertEqual(sql(f"SELECT scrubbed AND content='{{}}'::jsonb FROM experience_versions WHERE id='{ident(308)}'"),'t')
            self.assertEqual(sql(f"SELECT value FROM profile_versions WHERE id='{ident(310)}'"),'CONCLUSION_FIRST')
        self.assertFalse((restored/'objects'/(ident(22)+'.blob')).exists())

    def test_current_reader_revocation_does_not_reopen_publication_feedback(self):
        with backup.offline_database(self.source) as (_,__,sql):self.publication_feedback_fixture(sql)
        bundle,restored=self.root/'bundle',self.root/'restored'
        backup.create(self.source,bundle,self.key)
        with backup.offline_database(self.source) as (_,__,sql):sql(f"DELETE FROM workspace_members WHERE workspace_id='{ident(3)}' AND account_id='{ident(301)}'")
        backup.restore(bundle,restored,self.key);backup_recovery.activate(restored,self.source,self.key)
        with backup.offline_database(restored) as (_,__,sql):
            self.assertEqual(sql(f"SELECT count(*) FROM readable_feedback WHERE id='{ident(303)}'"),'0')
            self.assertEqual(sql(f"SELECT count(*) FROM readable_source_tasks WHERE id='{ident(306)}'"),'0')
            self.assertEqual(sql(f"SELECT count(*) FROM workspace_members WHERE workspace_id='{ident(3)}' AND account_id='{ident(301)}'"),'0')
            self.assertEqual(sql(f"SELECT assessment->>'suggestion' FROM feedback_versions WHERE id='{ident(304)}'"),'private reader opinion')

    def test_current_feedback_withdrawal_cannot_reopen_old_active_opinion(self):
        with backup.offline_database(self.source) as (_,__,sql):self.publication_feedback_fixture(sql)
        bundle=self.root/'bundle'
        backup.create(self.source,bundle,self.key)
        for revision,status in ((2,'WITHDRAWN'),(3,'ACTIVE')):
            with self.subTest(status=status):
                restored=self.root/('restored-'+status)
                with backup.offline_database(self.source) as (_,__,sql):
                    sql(f"INSERT INTO feedback_versions(id,feedback_id,revision,status,assessment) VALUES('{ident(310+revision)}','{ident(303)}',{revision},'{status}','{{\"suggestion\":\"new private authority text must not be copied\"}}'); UPDATE feedback_entries SET revision={revision} WHERE id='{ident(303)}'")
                backup.restore(bundle,restored,self.key);backup_recovery.reconcile(restored,self.source,self.key)
                backup_recovery.activate(restored,self.source,self.key)
                with backup.offline_database(restored) as (_,__,sql):
                    self.assertEqual(sql(f"SELECT count(*) FROM readable_feedback WHERE id='{ident(303)}'"),'0')
                    self.assertEqual(sql(f"SELECT state FROM object_lifecycle WHERE kind='FEEDBACK_VERSION' AND object_id='{ident(304)}'"),'ISOLATED')
                    self.assertEqual(sql(f"SELECT count(*) FROM feedback_versions WHERE feedback_id='{ident(303)}' AND revision>1"),'0')
                    self.assertEqual(sql(f"SELECT count(*) FROM active_materials WHERE id='{ident(20)}'"),'1')
                    self.assertEqual(sql(f"SELECT value FROM profile_versions WHERE id='{ident(310)}'"),'CONCLUSION_FIRST')

    @unittest.skipUnless(os.environ.get('RUN_BACKUP_HTTP_TESTS')=='1','requires compiled current API classes and Maven dependency report')
    def test_restored_publication_feedback_http_and_old_receipt_gate(self):
        with backup.offline_database(self.source) as (_,__,sql):self.publication_feedback_fixture(sql)
        bundle,restored=self.root/'bundle',self.root/'restored'
        backup.create(self.source,bundle,self.key)
        with backup.offline_database(self.source) as (_,__,sql):sql(f"SELECT scrub_lifecycle_object('TASK','{ident(41)}')")
        backup.restore(bundle,restored,self.key);backup_recovery.activate(restored,self.source,self.key)
        creds=trial.private_read(restored/'accounts.json')['recovered']
        reader=next(x for x in creds if x['accountId']==ident(301));author=next(x for x in creds if x['accountId']==ident(1))
        path=f'/api/v1/tenants/{ident(2)}/feedback/{ident(303)}'
        followup={'requestId':str(uuid.uuid4()),'expectedRevision':1,'action':{'kind':'PREFERENCE','confirmed':True,'preference':{'scenario':'GENERAL','style':'CONCLUSION_FIRST','expectedProfileRevision':0}}}
        import urllib.error
        with self.http(restored) as (url,browser,post):
            client=browser();post(client,'/api/v1/auth/login',{'email':reader['email'],'password':reader['password']}).close()
            opinion=json.load(client.open(url+path));self.assertEqual(opinion['target']['kind'],'PUBLICATION');self.assertIsNone(opinion['target'].get('taskId'))
            self.assertEqual(opinion['assessment']['suggestion'],'private reader opinion')
            receipt=json.load(post(client,path+'/actions',followup));self.assertEqual(receipt['status'],'APPLIED')
            other=browser();post(other,'/api/v1/auth/login',{'email':author['email'],'password':author['password']}).close()
            with self.assertRaises(urllib.error.HTTPError) as rejected:other.open(url+path)
            self.assertEqual(rejected.exception.code,404);rejected.exception.close()
        # Simulate the exact isolated state applied when the current authority changed its opinion.
        # The prior action receipt still exists but cannot bypass current feedback authorization.
        with backup.offline_database(restored) as (_,__,sql):sql(f"UPDATE object_lifecycle SET state='ISOLATED' WHERE kind='FEEDBACK_VERSION' AND object_id='{ident(304)}'")
        with self.http(restored) as (url,browser,post):
            client=browser();post(client,'/api/v1/auth/login',{'email':reader['email'],'password':reader['password']}).close()
            for action in (lambda:client.open(url+path),lambda:post(client,path+'/actions',followup)):
                with self.assertRaises(urllib.error.HTTPError) as rejected:action()
                self.assertEqual(rejected.exception.code,404);rejected.exception.close()
            self.assertEqual(client.open(url+f'/api/v1/tenants/{ident(2)}/workspaces/{ident(3)}/materials/{ident(20)}/versions/{ident(21)}/download').read(),b'synthetic original 20')

    def task_work_fixture(self,sql):
        sql(f"""INSERT INTO profile_entries(id,tenant_id,scope,account_id,entry_key,kind,created_by)
          VALUES('{ident(400)}','{ident(2)}','PERSONAL','{ident(1)}','response-length','PREFERENCE','{ident(1)}');
        INSERT INTO profile_versions(id,tenant_id,entry_id,revision,value,provenance,status,changed_by)
          VALUES('{ident(401)}','{ident(2)}','{ident(400)}',1,'CONCISE','explicit independent enum','ACTIVE','{ident(1)}');
        INSERT INTO task_plan_checks(id,tenant_id,owner_id,task_id,attempt_number,plan_id,execution_epoch,request_id,request_hash,accepted_revision,check_at,reason)
          SELECT '{ident(402)}',tenant_id,owner_id,'{ident(41)}',1,id,execution_epoch,'{ident(403)}','{'b'*64}',revision,now()+interval '1 hour','private follow-up reason'
          FROM ongoing_plans WHERE id='{ident(80)}';
        INSERT INTO task_preference_saves(id,tenant_id,owner_id,task_id,attempt_number,request_id,request_hash,category,choice,profile_id,profile_revision,evidence_source,evidence_offset,evidence_length,evidence_sha)
          VALUES('{ident(404)}','{ident(2)}','{ident(1)}','{ident(41)}',1,'{ident(405)}','{'c'*64}','RESPONSE_LENGTH','CONCISE','{ident(400)}',1,'PROMPT',0,9,'{'d'*64}');
        """)

    def test_task_work_restore_cancels_pending_without_replaying_independent_preference(self):
        with backup.offline_database(self.source) as (_,__,sql):self.task_work_fixture(sql)
        bundle,restored=self.root/'bundle',self.root/'restored'
        backup.create(self.source,bundle,self.key);backup.restore(bundle,restored,self.key)
        backup_recovery.activate(restored,self.source,self.key)
        with backup.offline_database(restored) as (_,__,sql):
            self.assertEqual(sql(f"SELECT state FROM task_plan_checks WHERE id='{ident(402)}'"),'CANCELLED')
            self.assertEqual(sql(f"SELECT reason FROM task_plan_checks WHERE id='{ident(402)}'"),'private follow-up reason')
            self.assertEqual(sql(f"SELECT status FROM ongoing_plans WHERE id='{ident(80)}'"),'PAUSED')
            self.assertEqual(sql(f"SELECT status||':'||value FROM profile_versions WHERE id='{ident(401)}'"),'ACTIVE:CONCISE')
            self.assertEqual(sql(f"SELECT count(*) FROM profile_versions WHERE entry_id='{ident(400)}'"),'1')
            self.assertEqual(sql('SELECT count(*) FROM conversation_tasks'),'1')
            self.assertEqual(sql('SELECT count(*) FROM task_preference_saves'),'1')
        # The actual dispatch after the snapshot is a fact, but its new task is not invented.
        with backup.offline_database(self.source) as (_,__,sql):
            sql(f"INSERT INTO conversation_tasks(id,tenant_id,workspace_id,conversation_id,requested_by,prompt,mode,status) VALUES('{ident(406)}','{ident(2)}','{ident(3)}','{ident(40)}','{ident(1)}','later task','SOURCE_LOOKUP','SUCCEEDED'); UPDATE task_plan_checks SET state='DISPATCHED',dispatched_task_id='{ident(406)}' WHERE id='{ident(402)}'")
        later=self.root/'restored-later'
        backup.restore(bundle,later,self.key);backup_recovery.activate(later,self.source,self.key)
        with backup.offline_database(later) as (_,__,sql):
            self.assertEqual(sql(f"SELECT state||':'||(dispatched_task_id IS NULL)::text FROM task_plan_checks WHERE id='{ident(402)}'"),'DISPATCHED:true')
            self.assertEqual(sql(f"SELECT count(*) FROM conversation_tasks WHERE id='{ident(406)}'"),'0')
            self.assertEqual(sql(f"SELECT status FROM ongoing_plans WHERE id='{ident(80)}'"),'PAUSED')

    def task_work_erasure(self,operation):
        with backup.offline_database(self.source) as (_,__,sql):self.task_work_fixture(sql)
        bundle=self.root/'bundle'
        backup.create(self.source,bundle,self.key)
        with backup.offline_database(self.source) as (_,__,sql):
            if operation=='reason':sql(f"SELECT scrub_task_work_task('{ident(41)}')")
            elif operation=='task':sql(f"SELECT scrub_lifecycle_object('TASK','{ident(41)}')")
            else:sql(f"INSERT INTO content_lifecycle(tenant_id,workspace_id,object_kind,object_id,state) VALUES('{ident(2)}','{ident(3)}','MATERIAL','{ident(10)}','PURGED')")
        if operation=='material':(self.source/'objects'/(ident(12)+'.blob')).unlink()
        restored=self.root/'restored'
        backup.restore(bundle,restored,self.key);backup_recovery.activate(restored,self.source,self.key)
        with backup.offline_database(restored) as (_,__,sql):
            self.assertEqual(sql(f"SELECT scrubbed AND reason='' AND state='CANCELLED' FROM task_plan_checks WHERE id='{ident(402)}'"),'t')
            self.assertEqual(sql(f"SELECT value FROM profile_versions WHERE id='{ident(401)}'"),'CONCISE')

    def test_task_work_current_erasure_removes_old_reason(self):self.task_work_erasure('reason')
    def test_task_work_task_purge_removes_old_reason(self):self.task_work_erasure('task')
    def test_task_work_material_purge_removes_old_reason(self):self.task_work_erasure('material')

    def test_focus_layout_uses_current_exact_positions_without_replaying_moves(self):
        with backup.offline_database(self.source) as (_,__,sql):
            sql(f"""INSERT INTO conversations(id,tenant_id,workspace_id,owner_id,title) VALUES('{ident(600)}','{ident(2)}','{ident(4)}','{ident(1)}','second focused conversation');
            INSERT INTO briefing_preferences(tenant_id,workspace_id,conversation_id,owner_id,pinned,hidden,size,revision)
              VALUES('{ident(2)}','{ident(3)}','{ident(40)}','{ident(1)}',true,false,'STANDARD',1),('{ident(2)}','{ident(4)}','{ident(600)}','{ident(1)}',true,false,'STANDARD',1);
            INSERT INTO briefing_layout_moves(id,tenant_id,owner_id,conversation_id,anchor_id,direction,applied_revision)
              SELECT '{ident(602)}',tenant_id,owner_id,'{ident(40)}','{ident(600)}','BEFORE',revision FROM briefing_layouts;
            """)
            original=int(sql('SELECT applied_revision FROM briefing_layout_moves'))
        bundle,restored=self.root/'bundle',self.root/'restored'
        backup.create(self.source,bundle,self.key)
        with backup.offline_database(self.source) as (_,__,sql):
            # Values intentionally exceed JSON float integer precision and differ at the last digit.
            sql(f"UPDATE briefing_preferences SET focus_position=CASE WHEN conversation_id='{ident(40)}' THEN 9007199254740992.000000000002 ELSE 9007199254740992.000000000001 END")
            current=int(sql('SELECT revision FROM briefing_layouts'))
            sql(f"INSERT INTO briefing_layout_moves(id,tenant_id,owner_id,conversation_id,anchor_id,direction,applied_revision) SELECT '{ident(603)}',tenant_id,owner_id,'{ident(600)}','{ident(40)}','BEFORE',revision FROM briefing_layouts")
        backup.restore(bundle,restored,self.key);backup_recovery.activate(restored,self.source,self.key)
        with backup.offline_database(restored) as (_,__,sql):
            self.assertEqual(sql('SELECT conversation_id::text FROM briefing_preferences WHERE pinned ORDER BY focus_position').splitlines(),[ident(600),ident(40)])
            self.assertEqual(sql('SELECT focus_position::text FROM briefing_preferences ORDER BY focus_position').splitlines(),['9007199254740992.000000000001','9007199254740992.000000000002'])
            self.assertGreater(int(sql('SELECT revision FROM briefing_layouts')),current)
            self.assertEqual(sql('SELECT count(*) FROM briefing_layout_moves'),'1')
            self.assertEqual(int(sql('SELECT applied_revision FROM briefing_layout_moves')),original)

    def adjustment_fixture(self,sql):
        self.publication_feedback_fixture(sql)
        for base,actor,space,card_kind,card,feedback,version,material,source in (
            (700,1,4,'BRIEFING',40,60,61,11,41),
            (710,301,302,'PUBLICATION',20,303,304,21,None)):
            sql(f"""INSERT INTO conversations(id,tenant_id,workspace_id,owner_id,title,purpose)
              VALUES('{ident(base)}','{ident(2)}','{ident(space)}','{ident(actor)}','private card adjustment','BRIEFING_ADJUSTMENT');
            INSERT INTO feedback_adjustment_threads(id,tenant_id,owner_id,card_kind,card_id,conversation_id)
              VALUES('{ident(base+2)}','{ident(2)}','{ident(actor)}','{card_kind}','{ident(card)}','{ident(base)}');
            """)
            # Two explicit messages; the second actually copied the first one's history.
            for ordinal in (1,2):
                task=base+ordinal*4
                sql(f"""INSERT INTO conversation_tasks(id,tenant_id,workspace_id,conversation_id,requested_by,prompt,mode,status)
                  VALUES('{ident(task)}','{ident(2)}','{ident(space)}','{ident(base)}','{ident(actor)}','specific adjustment request','AGENT','WAITING_CAPABILITY');
                INSERT INTO feedback_adjustment_messages(id,thread_id,ordinal,task_id,feedback_version_id,source_target,snapshot,request_text,history_task_ids)
                  VALUES('{ident(task+1)}','{ident(base+2)}',{ordinal},'{ident(task)}','{ident(version)}','{{"kind":"{card_kind}","versionId":"{ident(material)}"}}',
                    '{{"title":"shown title","excerpt":"sensitive shown excerpt"}}','private request {ordinal}',
                    {'ARRAY[]::uuid[]' if ordinal==1 else "ARRAY['"+ident(base+4)+"']::uuid[]"});
                INSERT INTO feedback_task_sources VALUES('{ident(task)}','{ident(material)}','{ident(feedback)}');
                """)
                dependencies=([source] if source else [])+([base+4] if ordinal==2 else [])
                for src in dependencies:
                    sql(f"INSERT INTO adjustment_task_dependencies(task_id,source_task_id,source_revision,source_attempt) VALUES('{ident(task)}','{ident(src)}',0,0)")

    def test_adjustment_source_task_purge_preserves_independent_publication_work(self):
        with backup.offline_database(self.source) as (_,__,sql):self.adjustment_fixture(sql)
        bundle,restored=self.root/'bundle',self.root/'restored'
        backup.create(self.source,bundle,self.key)
        with backup.offline_database(self.source) as (_,__,sql):sql(f"SELECT scrub_lifecycle_object('TASK','{ident(41)}')")
        backup.restore(bundle,restored,self.key);backup_recovery.activate(restored,self.source,self.key)
        with backup.offline_database(restored) as (_,__,sql):
            self.assertEqual(sql(f"SELECT count(*) FROM feedback_adjustment_messages WHERE thread_id='{ident(702)}' AND scrubbed AND snapshot='{{}}' AND request_text=''"),'2')
            self.assertEqual(sql(f"SELECT count(*) FROM feedback_adjustment_messages WHERE thread_id='{ident(712)}' AND NOT scrubbed AND request_text<>''"),'2')
            self.assertEqual(sql(f"SELECT object_is_active('TASK','{ident(718)}')"),'t')
            self.assertEqual(sql(f"SELECT status FROM conversation_tasks WHERE id='{ident(718)}'"),'PAUSED')
            self.assertEqual(sql(f"SELECT count(*) FROM adjustment_task_dependencies WHERE task_id IN('{ident(714)}','{ident(718)}') AND source_task_id='{ident(41)}'"),'0')

    def test_adjustment_material_erasure_clears_saved_snapshot_and_history(self):
        with backup.offline_database(self.source) as (_,__,sql):self.adjustment_fixture(sql)
        bundle,restored=self.root/'bundle',self.root/'restored'
        backup.create(self.source,bundle,self.key)
        with backup.offline_database(self.source) as (_,__,sql):
            sql(f"INSERT INTO content_lifecycle(tenant_id,workspace_id,object_kind,object_id,state) VALUES('{ident(2)}','{ident(3)}','MATERIAL','{ident(20)}','PURGED')")
        (self.source/'objects'/(ident(22)+'.blob')).unlink()
        backup.restore(bundle,restored,self.key);backup_recovery.activate(restored,self.source,self.key)
        with backup.offline_database(restored) as (_,__,sql):
            self.assertEqual(sql(f"SELECT count(*) FROM feedback_adjustment_messages WHERE thread_id='{ident(712)}' AND scrubbed AND snapshot='{{}}' AND request_text=''"),'2')
            self.assertEqual(sql(f"SELECT object_is_active('TASK','{ident(718)}')"),'f')
            self.assertFalse((restored/'objects'/(ident(22)+'.blob')).exists())

    def test_adjustment_opinion_withdrawal_does_not_cancel_explicit_private_work(self):
        with backup.offline_database(self.source) as (_,__,sql):self.adjustment_fixture(sql)
        bundle,restored=self.root/'bundle',self.root/'restored'
        backup.create(self.source,bundle,self.key)
        with backup.offline_database(self.source) as (_,__,sql):
            sql(f"""INSERT INTO feedback_versions(id,feedback_id,revision,status,assessment)
              VALUES('{ident(730)}','{ident(303)}',2,'WITHDRAWN','{{}}');
              UPDATE feedback_entries SET revision=2 WHERE id='{ident(303)}';""")
        backup.restore(bundle,restored,self.key);backup_recovery.activate(restored,self.source,self.key)
        with backup.offline_database(restored) as (_,__,sql):
            self.assertEqual(sql(f"SELECT object_is_active('FEEDBACK_VERSION','{ident(304)}')"),'f')
            self.assertEqual(sql(f"SELECT object_is_active('TASK','{ident(718)}')"),'t')
            self.assertEqual(sql(f"SELECT count(*) FROM feedback_adjustment_messages WHERE NOT scrubbed"),'4')
            self.assertEqual(sql(f"SELECT count(*) FROM conversation_tasks WHERE conversation_id IN('{ident(700)}','{ident(710)}')"),'4')
            self.assertEqual(sql(f"SELECT count(*) FROM feedback_versions WHERE feedback_id='{ident(303)}'"),'1')
            self.assertEqual(sql(f"SELECT count(*) FROM conversation_tasks WHERE conversation_id IN('{ident(700)}','{ident(710)}') AND status='PAUSED'"),'4')

    def forwarding_fixture(self,sql):
        self.publication_feedback_fixture(sql)
        sql(f"""INSERT INTO publication_forward_batches(id,tenant_id,sender_id,publication_id,material_version_id,request_id,request_hash,note)
          VALUES('{ident(800)}','{ident(2)}','{ident(1)}','{ident(46)}','{ident(21)}','{ident(801)}','{'b'*64}','private forwarding note');
        INSERT INTO publication_forward_receipts(id,batch_id,recipient_id) VALUES('{ident(802)}','{ident(800)}','{ident(301)}');""")

    def test_forwarding_keeps_actual_open_fact_without_resending_or_author_task_dependency(self):
        with backup.offline_database(self.source) as (_,__,sql):self.forwarding_fixture(sql)
        bundle,restored=self.root/'bundle',self.root/'restored'
        backup.create(self.source,bundle,self.key)
        with backup.offline_database(self.source) as (_,__,sql):
            sql(f"UPDATE publication_forward_receipts SET opened_at=now() WHERE id='{ident(802)}'; SELECT scrub_lifecycle_object('TASK','{ident(41)}')")
            opened=sql('SELECT opened_at::text FROM publication_forward_receipts')
        backup.restore(bundle,restored,self.key);backup_recovery.activate(restored,self.source,self.key)
        with backup.offline_database(restored) as (_,__,sql):
            self.assertEqual(sql('SELECT note FROM publication_forward_batches'),'private forwarding note')
            self.assertEqual(sql('SELECT opened_at::text FROM publication_forward_receipts'),opened)
            self.assertEqual(sql('SELECT count(*) FROM publication_forward_receipts'),'1')
            self.assertEqual(sql(f"SELECT forwarding_publication_readable('{ident(301)}','{ident(2)}','{ident(46)}','{ident(21)}')"),'t')

    def forwarding_current_change(self,operation):
        with backup.offline_database(self.source) as (_,__,sql):self.forwarding_fixture(sql)
        bundle,restored=self.root/'bundle',self.root/'restored'
        backup.create(self.source,bundle,self.key)
        with backup.offline_database(self.source) as (_,__,sql):
            if operation=='scope':sql(f"SELECT scrub_forwarding_scope('{ident(2)}','{ident(1)}')")
            elif operation=='revoke':sql(f"DELETE FROM workspace_members WHERE account_id='{ident(301)}'")
            else:sql(f"INSERT INTO content_lifecycle(tenant_id,workspace_id,object_kind,object_id,state) VALUES('{ident(2)}','{ident(3)}','MATERIAL','{ident(20)}','PURGED')")
        if operation=='material':(self.source/'objects'/(ident(22)+'.blob')).unlink()
        backup.restore(bundle,restored,self.key);backup_recovery.activate(restored,self.source,self.key)
        with backup.offline_database(restored) as (_,__,sql):
            self.assertEqual(sql('SELECT count(*) FROM publication_forward_receipts'),'1')
            if operation=='revoke':
                self.assertEqual(sql(f"SELECT forwarding_publication_readable('{ident(301)}','{ident(2)}','{ident(46)}','{ident(21)}')"),'f')
            else:
                self.assertEqual(sql('SELECT note FROM publication_forward_batches'),'')
                self.assertEqual(sql('SELECT scrubbed FROM publication_forward_batches'),'t')
            if operation=='scope':
                self.assertEqual(sql(f"SELECT forwarding_publication_readable('{ident(301)}','{ident(2)}','{ident(46)}','{ident(21)}')"),'t')

    def test_forwarding_current_scope_scrub_does_not_reopen_old_note(self):self.forwarding_current_change('scope')
    def test_forwarding_material_scrub_does_not_reopen_old_note(self):self.forwarding_current_change('material')
    def test_forwarding_recipient_receipt_does_not_restore_revoked_access(self):self.forwarding_current_change('revoke')

    def newer_profile(self,sql):
        sql(f"""INSERT INTO profile_versions(id,tenant_id,entry_id,revision,value,provenance,status,changed_by)
          VALUES('{ident(901)}','{ident(2)}','{ident(70)}',2,'current business goal','explicit current','ACTIVE','{ident(1)}');
          UPDATE profile_entries SET revision=2 WHERE id='{ident(70)}';""")

    def test_profile_precise_old_version_purge_preserves_current_value(self):
        with backup.offline_database(self.source) as (_,__,sql):self.newer_profile(sql)
        bundle,restored=self.root/'bundle',self.root/'restored'
        backup.create(self.source,bundle,self.key)
        with backup.offline_database(self.source) as (_,__,sql):
            self.assertEqual(sql(f"SELECT cardinality(lifecycle_version_blockers('PROFILE_VERSION','{ident(71)}'))"),'0')
            sql(f"SELECT scrub_lifecycle_object('PROFILE_VERSION','{ident(71)}')")
        backup.restore(bundle,restored,self.key);backup_recovery.activate(restored,self.source,self.key)
        with backup.offline_database(restored) as (_,__,sql):
            self.assertEqual(sql(f"SELECT value||provenance FROM profile_versions WHERE id='{ident(71)}'"),'')
            self.assertEqual(sql(f"SELECT scrubbed FROM profile_versions WHERE id='{ident(71)}'"),'t')
            self.assertEqual(sql(f"SELECT value FROM profile_versions WHERE id='{ident(901)}'"),'current business goal')
            self.assertEqual(sql(f"SELECT status FROM profile_versions WHERE id='{ident(901)}'"),'ACTIVE')
            self.assertEqual(sql(f"SELECT object_is_active('PROFILE_VERSION','{ident(71)}')"),'f')

    def test_profile_current_body_tombstone_cannot_reopen_old_history(self):
        bundle,restored=self.root/'bundle',self.root/'restored'
        backup.create(self.source,bundle,self.key)
        with backup.offline_database(self.source) as (_,__,sql):
            # Same write performed by authorized residual cleanup; bookkeeping may still say ACTIVE.
            sql(f"UPDATE profile_versions SET value='',provenance='',status='WITHDRAWN' WHERE id='{ident(71)}'")
            self.assertEqual(sql(f"SELECT state FROM object_lifecycle WHERE kind='PROFILE_VERSION' AND object_id='{ident(71)}'"),'ACTIVE')
        backup.restore(bundle,restored,self.key);backup_recovery.activate(restored,self.source,self.key)
        with backup.offline_database(restored) as (_,__,sql):
            self.assertEqual(sql(f"SELECT value||provenance FROM profile_versions WHERE id='{ident(71)}'"),'')
            self.assertEqual(sql(f"SELECT state FROM object_lifecycle WHERE kind='PROFILE_VERSION' AND object_id='{ident(71)}'"),'PURGED')
            self.assertEqual(sql(f"SELECT object_is_active('PROFILE_VERSION','{ident(71)}')"),'f')

    def test_profile_task_dependency_follows_current_purge_not_snapshot_dependency(self):
        with backup.offline_database(self.source) as (_,__,sql):
            sql(f"INSERT INTO task_context_reads(task_id,attempt_number,kind,reference_id,version_key,content_hash) VALUES('{ident(41)}',1,'PROFILE','{ident(70)}','1','{'c'*64}')")
            self.assertIn('PROFILE_TASK_DEPENDENCY',sql(f"SELECT lifecycle_version_blockers('PROFILE_VERSION','{ident(71)}')::text"))
        bundle,restored=self.root/'bundle',self.root/'restored'
        backup.create(self.source,bundle,self.key)
        with backup.offline_database(self.source) as (_,__,sql):
            self.newer_profile(sql)
            sql(f"SELECT scrub_lifecycle_object('TASK','{ident(41)}')")
            self.assertEqual(sql(f"SELECT cardinality(lifecycle_version_blockers('PROFILE_VERSION','{ident(71)}'))"),'0')
            sql(f"SELECT scrub_lifecycle_object('PROFILE_VERSION','{ident(71)}')")
        backup.restore(bundle,restored,self.key);backup_recovery.activate(restored,self.source,self.key)
        with backup.offline_database(restored) as (_,__,sql):
            self.assertEqual(sql(f"SELECT value||provenance FROM profile_versions WHERE id='{ident(71)}'"),'')
            self.assertEqual(sql(f"SELECT coalesce(reply,'') FROM conversation_tasks WHERE id='{ident(41)}'"),'')
            self.assertEqual(sql(f"SELECT object_is_active('TASK','{ident(41)}')"),'f')
            self.assertEqual(sql(f"SELECT count(*) FROM profile_versions WHERE status='ACTIVE'"),'0')

    def independent_new_method(self,sql):
        sql(f"""INSERT INTO method_versions(id,family_id,number,base_version,configuration,configuration_sha,compatibility,rationale,created_by)
          VALUES('{ident(950)}','{ident(120)}',2,'{ident(121)}','{{"relevanceWeight":0.5,"recencyWeight":0.3,"importanceWeight":0.2}}','{'d'*64}','ranking-v1','new independent candidate','{ident(1)}');
          INSERT INTO method_comparisons(id,candidate_version,standard_version,sample_versions,results,created_by)
          VALUES('{ident(951)}','{ident(950)}','{ident(111)}','{{"items":["{ident(113)}"]}}','{{"items":[]}}','{ident(1)}');
          INSERT INTO method_releases VALUES('{ident(950)}','{ident(951)}','{ident(1)}',now());
          UPDATE method_families SET head_version='{ident(950)}',published_version='{ident(950)}',revision=revision+1 WHERE id='{ident(120)}';
          UPDATE method_adoptions SET version_id='{ident(950)}',revision=revision+1 WHERE id='{ident(123)}';""")

    def method_current_purge(self,retained_current):
        with backup.offline_database(self.source) as (_,__,sql):
            self.assertIn('METHOD_ACTIVE_ADOPTION',sql(f"SELECT lifecycle_version_blockers('METHOD_VERSION','{ident(121)}')::text"))
            if retained_current:self.independent_new_method(sql)
        bundle,restored=self.root/'bundle',self.root/'restored'
        backup.create(self.source,bundle,self.key)
        with backup.offline_database(self.source) as (_,__,sql):
            if not retained_current:self.independent_new_method(sql)
            # Pure base_version lineage does not require retaining the old configuration forever.
            self.assertEqual(sql(f"SELECT cardinality(lifecycle_version_blockers('METHOD_VERSION','{ident(121)}'))"),'0')
            sql(f"SELECT scrub_lifecycle_object('METHOD_VERSION','{ident(121)}')")
        backup.restore(bundle,restored,self.key);backup_recovery.activate(restored,self.source,self.key)
        with backup.offline_database(restored) as (_,__,sql):
            self.assertEqual(sql(f"SELECT configuration::text FROM method_versions WHERE id='{ident(121)}'"),'{}')
            self.assertEqual(sql(f"SELECT rationale FROM method_versions WHERE id='{ident(121)}'"),'')
            self.assertEqual(sql(f"SELECT object_is_active('METHOD_VERSION','{ident(121)}')"),'f')
            if retained_current:
                self.assertEqual(sql('SELECT head_version::text FROM method_families'),ident(950))
                self.assertEqual(sql('SELECT published_version::text FROM method_families'),ident(950))
                self.assertEqual(sql('SELECT status FROM method_adoptions'),'ACTIVE')
                self.assertEqual(sql('SELECT version_id::text FROM method_adoptions'),ident(950))
                self.assertEqual(sql(f"SELECT rationale FROM method_versions WHERE id='{ident(950)}'"),'new independent candidate')
            else:
                self.assertEqual(sql("SELECT coalesce(head_version::text,'') FROM method_families"),'')
                self.assertEqual(sql("SELECT coalesce(published_version::text,'') FROM method_families"),'')
                self.assertEqual(sql('SELECT status FROM method_adoptions'),'STOPPED')
                self.assertEqual(sql(f"SELECT count(*) FROM method_versions WHERE id='{ident(950)}'"),'0')

    def test_method_current_purge_does_not_reopen_old_head_or_adoption(self):self.method_current_purge(False)
    def test_method_precise_old_version_purge_preserves_retained_current_adoption(self):self.method_current_purge(True)

    @unittest.skipUnless(os.environ.get('RUN_BACKUP_HTTP_TESTS')=='1','requires compiled current API classes and Maven dependency report')
    def test_restored_version_tombstones_hide_profile_and_method_bodies_over_http(self):
        with backup.offline_database(self.source) as (_,__,sql):
            self.newer_profile(sql);self.independent_new_method(sql)
            sql(f"UPDATE method_versions SET rationale='retired sensitive method explanation' WHERE id='{ident(121)}'")
        bundle,restored=self.root/'bundle',self.root/'restored'
        backup.create(self.source,bundle,self.key)
        with backup.offline_database(self.source) as (_,__,sql):
            sql(f"SELECT scrub_lifecycle_object('PROFILE_VERSION','{ident(71)}'); SELECT scrub_lifecycle_object('METHOD_VERSION','{ident(121)}')")
        backup.restore(bundle,restored,self.key);backup_recovery.activate(restored,self.source,self.key)
        credentials=trial.private_read(restored/'accounts.json')['recovered'][0]
        import urllib.error
        with self.http(restored) as (url,browser,post):
            client=browser();post(client,'/api/v1/auth/login',{'email':credentials['email'],'password':credentials['password']}).close()
            path=url+f'/api/v1/tenants/{ident(2)}/profiles/entries/{ident(70)}'
            with self.assertRaises(urllib.error.HTTPError) as unavailable:client.open(path+'?version=1')
            self.assertEqual(unavailable.exception.code,404);unavailable.exception.close()
            self.assertEqual(json.load(client.open(path+'?version=2'))['value'],'current business goal')
            family=json.load(client.open(url+f'/api/platform-admin/v1/methods/{ident(120)}'))
            old=next(v for v in family['versions'] if v['id']==ident(121))
            current=next(v for v in family['versions'] if v['id']==ident(950))
            self.assertFalse(old['bodyAvailable']);self.assertIsNone(old.get('configuration'));self.assertEqual(old['rationale'],'')
            self.assertTrue(current['bodyAvailable']);self.assertEqual(family['publishedVersion'],ident(950))

    def test_current_scope_fence_and_later_registered_legacy_object(self):
        with backup.offline_database(self.source) as (_,__,sql):
            sql("DELETE FROM object_lifecycle WHERE kind='EXPERIENCE_VERSION'")
        bundle,restored=self.root/'bundle',self.root/'restored'
        backup.create(self.source,bundle,self.key)
        with backup.offline_database(self.source) as (_,__,sql):
            sql(f"""INSERT INTO object_lifecycle(kind,object_id,tenant_id,workspace_id,original_anchor,state)
              SELECT kind,object_id,tenant_id,workspace_id,original_anchor,'PURGED' FROM lifecycle_object_sources WHERE kind='EXPERIENCE_VERSION';
            SELECT scrub_lifecycle_object('EXPERIENCE_VERSION','{ident(51)}');
            INSERT INTO object_lifecycle_scopes(execution_id,tenant_id,owner_id,effective_at,deadline,state)
              VALUES('{ident(190)}','{ident(2)}','{ident(1)}',now(),now()+interval '30 days','ISOLATED');
            INSERT INTO object_lifecycle_scope_items SELECT '{ident(190)}',id FROM object_lifecycle WHERE kind='TASK';""")
        backup.restore(bundle,restored,self.key);backup_recovery.activate(restored,self.source,self.key)
        with backup.offline_database(restored) as (_,__,sql):
            self.assertEqual(sql('SELECT content::text FROM experience_versions'),'{}')
            self.assertEqual(sql("SELECT state FROM object_lifecycle WHERE kind='EXPERIENCE_VERSION'"),'PURGED')
            self.assertEqual(sql('SELECT count(*) FROM object_lifecycle_scope_items'),'1')
            self.assertEqual(sql(f"SELECT object_is_active('TASK','{ident(41)}')"),'f')
            self.assertEqual(sql('SELECT status FROM ongoing_plans'),'PAUSED')

    def test_closed_notifications_do_not_return_and_sequences_advance(self):
        a,t,w,conversation,task=map(ident,[1,2,3,40,41])
        with backup.offline_database(self.source) as (_,__,sql):
            sql(f"""UPDATE conversation_tasks SET status='SUCCEEDED',finished_at=now()-interval '200 days' WHERE id='{task}';
            INSERT INTO conversation_events(tenant_id,workspace_id,conversation_id,task_id,kind,revision,created_at)
              VALUES('{t}','{w}','{conversation}','{task}','SUCCEEDED',1,now()-interval '200 days');
            INSERT INTO identity_audit(actor_id,tenant_id,action,target_id,outcome,created_at)
              VALUES('{a}','{t}','TASK_COMPLETE','{task}','SUCCESS',now()-interval '201 days'),
              ('{a}','{t}','WORKSPACE_GRANT','{task}','SUCCESS',now()-interval '201 days');""")
        bundle,restored=self.root/'bundle',self.root/'restored'
        backup.create(self.source,bundle,self.key)
        with backup.offline_database(self.source) as (_,__,sql):
            sql(f"""SELECT setval('conversation_events_seq_seq',99,true);
            INSERT INTO conversation_events(tenant_id,workspace_id,conversation_id,task_id,kind,revision,created_at)
              VALUES('{t}','{w}','{conversation}','{task}','SUCCEEDED',2,now()-interval '199 days');
            DELETE FROM conversation_events; DELETE FROM identity_audit WHERE action='TASK_COMPLETE';
            UPDATE operation_retention_windows SET state='COMPLETE',completed_at=now(),removed_events=1;""")
        backup.restore(bundle,restored,self.key);backup_recovery.activate(restored,self.source,self.key)
        with backup.offline_database(restored) as (_,__,sql):
            self.assertEqual(sql('SELECT count(*) FROM conversation_events'),'0')
            self.assertEqual(sql("SELECT count(*) FROM identity_audit WHERE action='TASK_COMPLETE'"),'0')
            self.assertEqual(sql("SELECT count(*) FROM identity_audit WHERE action='WORKSPACE_GRANT'"),'1')
            self.assertEqual(sql('SELECT count(*) FROM operation_retention_windows'),'2')
            self.assertEqual(sql('SELECT reply FROM conversation_tasks'),'sensitive derived response')
            self.assertGreater(int(sql("SELECT nextval('conversation_events_seq_seq')")),100)

    def departure(self,sql,number,kind='TENANT_EXIT',state='EXPORT_WINDOW',target=None):
        sql(f"""INSERT INTO departure_executions(id,tenant_id,kind,target_account_id,state,requested_by,reason,policy_key,policy_revision,effective_at,deadline,prior_tenant_status)
         VALUES('{ident(number)}','{ident(2)}','{kind}',{backup_recovery.literal(target)},'{state}','{ident(1)}','synthetic','EXIT_WINDOW',0,now(),now()+interval '30 days','ACTIVE')""")

    def test_exit_window_restores_only_current_grants_not_old_archive(self):
        a,t,w,p=map(ident,[1,2,3,4])
        with backup.offline_database(self.source) as (_,__,sql):
            sql(f"INSERT INTO governance_capabilities(tenant_id,account_id,workspace_id,capability,granted_by) VALUES('{t}','{a}','{w}','BULK_EXPORT','{a}')")
            sql(f"INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES('{ident(5)}','{t}','{a}','No current export','SHARED'); INSERT INTO workspace_members(tenant_id,workspace_id,account_id) VALUES('{t}','{ident(5)}','{a}'); INSERT INTO governance_capabilities(tenant_id,account_id,workspace_id,capability,granted_by) VALUES('{t}','{a}','{ident(5)}','BULK_EXPORT','{a}');")
            self.departure(sql,200)
            sql(f"""INSERT INTO departure_export_grants VALUES('{ident(200)}','{t}','{a}','{ident(5)}');
            INSERT INTO departure_export_grants VALUES('{ident(200)}','{t}','{a}','{w}');
            INSERT INTO departure_export_sets(id,execution_id,tenant_id,owner_id,workspace_id,include_history,item_count,created_at)
             VALUES('{ident(201)}','{ident(200)}','{t}','{a}','{w}',true,1,now());
            INSERT INTO departure_export_parts(id,set_id,number,state,request_count,generation,created_at,bytes)
             VALUES('{ident(202)}','{ident(201)}',1,'READY',1,'{ident(203)}',now(),3);
            INSERT INTO departure_export_items(set_id,ordinal,kind,object_id,version_id,version,size_bytes,part_id,state,filename)
             VALUES('{ident(201)}',1,'MATERIAL_VERSION','{ident(20)}','{ident(21)}',1,3,'{ident(202)}','INCLUDED','old.pdf');
            INSERT INTO departure_archive_chunks VALUES('{ident(202)}','{ident(203)}',0,decode('6f6c64','hex'));""")
        bundle,restored=self.root/'bundle',self.root/'restored'
        backup.create(self.source,bundle,self.key)
        with backup.offline_database(self.source) as (_,__,sql):sql(f"DELETE FROM departure_export_grants WHERE workspace_id='{ident(5)}'")
        backup.restore(bundle,restored,self.key);backup_recovery.activate(restored,self.source,self.key)
        with backup.offline_database(restored) as (_,__,sql):
            self.assertEqual(sql(f"SELECT departure_content_readable('{a}','{t}','{ident(5)}')"),'f')
            self.assertEqual(sql('SELECT status FROM tenants'),'ACTIVE')
            self.assertEqual(sql('SELECT status FROM tenant_memberships'),'ACTIVE')
            self.assertEqual(sql(f"SELECT departure_content_readable('{a}','{t}','{w}')"),'t')
            self.assertEqual(sql(f"SELECT departure_content_readable('{a}','{t}','{p}')"),'f')
            self.assertEqual(sql('SELECT count(*) FROM departure_archive_chunks'),'0')
            self.assertEqual(sql('SELECT state FROM departure_export_parts'),'REVOKED')
            self.assertEqual(sql('SELECT state FROM departure_export_sets'),'REVOKED')
            self.assertEqual(sql("SELECT count(*) FROM pg_trigger WHERE tgname IN('departure_tenant_activation','departure_member_activation') AND tgenabled='O'"),'2')
            with self.assertRaises(trial.TrialError):sql("UPDATE tenant_memberships SET status='ACTIVE'")
            sql('DELETE FROM departure_export_grants')
            self.assertEqual(sql(f"SELECT departure_content_readable('{a}','{t}','{w}')"),'f')

    @unittest.skipUnless(os.environ.get('RUN_BACKUP_HTTP_TESTS')=='1','requires compiled current API classes and Maven dependency report')
    def test_exit_recovery_http_preserves_export_only_window(self):
        import urllib.error
        a,t,w=map(ident,[1,2,3])
        with backup.offline_database(self.source) as (_,__,sql):
            sql(f"INSERT INTO governance_capabilities(tenant_id,account_id,workspace_id,capability,granted_by) VALUES('{t}','{a}','{w}','BULK_EXPORT','{a}')")
            self.departure(sql,200)
            sql(f"INSERT INTO departure_export_grants VALUES('{ident(200)}','{t}','{a}','{w}')")
        bundle,restored=self.root/'bundle',self.root/'restored'
        backup.create(self.source,bundle,self.key);backup.restore(bundle,restored,self.key);backup_recovery.activate(restored,self.source,self.key)
        credentials=next(x for x in trial.private_read(restored/'accounts.json')['recovered'] if x['accountId']==a)
        with self.http(restored) as (url,browser,post):
            client=browser();self.assertEqual(post(client,'/api/v1/auth/login',{'email':credentials['email'],'password':credentials['password']}).status,200)
            base=f'/api/v1/tenants/{t}'
            self.assertEqual(client.open(url+base+f'/workspaces/{w}/materials/{ident(20)}/versions/{ident(21)}/download').read(),b'synthetic original 20')
            for path in [base+'/conversations',base+'/documents',base+f'/workspaces/{ident(4)}/library']:
                with self.subTest(path=path):
                    with self.assertRaises(urllib.error.HTTPError) as denied:client.open(url+path)
                    self.assertEqual(denied.exception.code,403);denied.exception.close()
            for path,body in [
                (base+f'/workspaces/{w}/folders',{'requestId':ident(250),'name':'Must not create'}),
                (base+'/conversations',{'requestId':ident(251),'workspaceId':w,'prompt':'Must not execute','mode':'SOURCE_LOOKUP'}),
                (f'/api/tenant-admin/v1/tenants/{t}/members/{a}/status',{'requestId':ident(252),'expectedVersion':0,'status':'ACTIVE'})]:
                with self.subTest(path=path):
                    with self.assertRaises(urllib.error.HTTPError) as denied:post(client,path,body)
                    self.assertIn(denied.exception.code,(403,409));denied.exception.close()

    def test_offboard_after_snapshot_blocks_still_active_member(self):
        bundle,restored=self.root/'bundle',self.root/'restored'
        backup.create(self.source,bundle,self.key)
        with backup.offline_database(self.source) as (_,__,sql):
            self.departure(sql,200,'MEMBER_OFFBOARD','ISOLATING',ident(1))
            self.assertEqual(sql('SELECT status FROM tenant_memberships'),'ACTIVE')
        backup.restore(bundle,restored,self.key);backup_recovery.activate(restored,self.source,self.key)
        with backup.offline_database(restored) as (_,__,sql):
            self.assertEqual(sql('SELECT status FROM tenant_memberships'),'DISABLED')
            self.assertEqual(sql('SELECT count(*) FROM workspace_members'),'0')
            self.assertEqual(sql(f"SELECT departure_content_readable('{ident(1)}','{ident(2)}','{ident(3)}')"),'f')
            self.assertEqual(sql('SELECT status FROM ongoing_plans'),'PAUSED')
            self.assertEqual(sql('SELECT status FROM conversation_tasks'),'RESULT_UNKNOWN')
            with self.assertRaises(trial.TrialError):sql("UPDATE tenant_memberships SET status='ACTIVE'")

    def test_explicit_cancelled_departure_replaces_snapshot_stop(self):
        with backup.offline_database(self.source) as (_,__,sql):self.departure(sql,200,'MEMBER_OFFBOARD','ISOLATED',ident(1))
        bundle,restored=self.root/'bundle',self.root/'restored'
        backup.create(self.source,bundle,self.key)
        with backup.offline_database(self.source) as (_,__,sql):
            sql("UPDATE departure_executions SET state='CANCELLED',revision=2,cancelled_at=now()")
        backup.restore(bundle,restored,self.key);backup_recovery.activate(restored,self.source,self.key)
        with backup.offline_database(restored) as (_,__,sql):
            self.assertEqual(sql('SELECT state FROM departure_executions'),'CANCELLED')
            self.assertEqual(sql('SELECT status FROM tenant_memberships'),'ACTIVE')
            self.assertEqual(sql('SELECT status FROM ongoing_plans'),'PAUSED')

    def test_activation_trigger_failure_rolls_back_and_stays_quarantined(self):
        bundle,restored=self.root/'bundle',self.root/'restored'
        backup.create(self.source,bundle,self.key);backup.restore(bundle,restored,self.key)
        with backup.offline_database(self.source) as (_,__,current_sql), backup.offline_database(restored) as (_,__,sql):
            def fail_before_enable(statement,*args):
                if 'ALTER TABLE tenants ENABLE TRIGGER departure_tenant_activation' in statement:
                    statement=statement.replace('ALTER TABLE tenants ENABLE TRIGGER departure_tenant_activation',"SELECT 1/0; ALTER TABLE tenants ENABLE TRIGGER departure_tenant_activation")
                return sql(statement,*args)
            with self.assertRaises(trial.TrialError):backup_recovery.reopen_current(fail_before_enable,current_sql,restored)
            self.assertEqual(sql("SELECT count(*) FROM pg_trigger WHERE tgname IN('departure_tenant_activation','departure_member_activation') AND tgenabled='O'"),'2')
            self.assertEqual(sql("SELECT count(*) FROM tenant_memberships WHERE status='ACTIVE'"),'0')
        with self.assertRaises(trial.TrialError):trial.start(restored)

    def test_missing_current_departure_identity_keeps_instance_closed(self):
        bundle,restored=self.root/'bundle',self.root/'restored'
        backup.create(self.source,bundle,self.key)
        with backup.offline_database(self.source) as (_,__,sql):
            sql(f"INSERT INTO accounts(id,email,display_name,password_hash) VALUES('{ident(290)}','new-authorizer@example.invalid','New','hash')")
            self.departure(sql,200)
            sql(f"UPDATE departure_executions SET requested_by='{ident(290)}'")
        backup.restore(bundle,restored,self.key)
        with self.assertRaisesRegex(trial.TrialError,'缺失的身份'):backup_recovery.activate(restored,self.source,self.key)
        with self.assertRaises(trial.TrialError):trial.start(restored)

    def residual_fixture(self,sql):
        if backup_recovery.has_table(sql,'task_plan_checks'):self.task_work_fixture(sql)
        a,t,w,p=map(ident,[1,2,3,4])
        sql(f"""INSERT INTO profile_entries(id,tenant_id,scope,account_id,entry_key,kind,created_by)
         VALUES('{ident(300)}','{t}','PERSONAL','{a}','private label','FACT','{a}');
        INSERT INTO profile_versions(id,tenant_id,entry_id,revision,value,provenance,status,changed_by)
         VALUES('{ident(301)}','{t}','{ident(300)}',1,'private profile','private provenance','ACTIVE','{a}');
        INSERT INTO ongoing_plan_versions(plan_id,revision,configuration,changed_by)
         VALUES('{ident(80)}',1,'{{"goal":"old goal","purpose":"old purpose","query":"old query"}}','{a}');
        INSERT INTO identity_requests(actor_id,request_id,operation,fingerprint,target_id)
         VALUES('{a}','{ident(302)}','PLAN_CREATE','{'0'*64}','{ident(80)}'),('{a}','{ident(303)}','RECOMMENDATION_CONFIGURE','{'0'*64}','{t}');
        INSERT INTO ongoing_plan_receipts VALUES('{a}','{ident(302)}','{{"configuration":{{"goal":"receipt goal","purpose":"receipt purpose","query":"receipt query"}}}}');
        INSERT INTO recommendation_receipts VALUES('{a}','{ident(303)}','{{"enabled":true}}');
        UPDATE conversation_tasks SET mode='AGENT',execution_class='verification',public_query='private external query';UPDATE knowledge_runs SET warnings='private diagnostic warning';
        INSERT INTO recommendation_presentations(tenant_id,actor_id,task_id,task_revision,attempt,fingerprint,method,presentation,settings_revision)
         VALUES('{t}','{a}','{ident(41)}',0,1,'{'0'*64}','{{}}','{{"style":"private style"}}',1);""")
        for number,space in [(310,w),(320,p)]:
            sql(f"""INSERT INTO profile_entries(id,tenant_id,scope,workspace_id,entry_key,kind,created_by) VALUES('{ident(number+5)}','{t}','WORKSPACE','{space}','space label','FACT','{a}');
            INSERT INTO profile_versions(id,tenant_id,entry_id,revision,value,provenance,status,changed_by) VALUES('{ident(number+6)}','{t}','{ident(number+5)}',1,'space profile','space provenance','ACTIVE','{a}');
            INSERT INTO business_sources(id,tenant_id,workspace_id,name,description,responsible_id,created_by)
             VALUES('{ident(number)}','{t}','{space}','sensitive source','sensitive description','{a}','{a}');
            INSERT INTO business_source_config_versions(source_id,revision,settings,changed_by)
             VALUES('{ident(number)}',0,'{{"name":"sensitive source","description":"sensitive description"}}','{a}');
            INSERT INTO business_source_submissions(id,tenant_id,workspace_id,source_id,coverage_from,coverage_through,note,submitted_by)
             VALUES('{ident(number+1)}','{t}','{space}','{ident(number)}',current_date,current_date,'sensitive submission note','{a}');""")

    def test_exit_complete_residual_text_is_not_revived(self):
        with backup.offline_database(self.source) as (_,__,sql):self.residual_fixture(sql)
        bundle,restored=self.root/'bundle',self.root/'restored'
        backup.create(self.source,bundle,self.key)
        with backup.offline_database(self.source) as (_,__,sql):
            self.departure(sql,200,state='COMPLETE')
            sql("UPDATE departure_executions SET effective_at=now()-interval '31 days',deadline=now()-interval '1 day',stop_complete=true; UPDATE profile_versions SET value='',provenance='',status='WITHDRAWN'")
        backup.restore(bundle,restored,self.key);backup_recovery.reconcile(restored,self.source,self.key);backup_recovery.activate(restored,self.source,self.key)
        with backup.offline_database(restored) as (_,__,sql):
            self.assertEqual(sql("SELECT count(*) FROM profile_versions WHERE value<>'' OR provenance<>''"),'0')
            self.assertEqual(sql("SELECT count(*) FROM profile_entries WHERE entry_key NOT LIKE 'removed-%'"),'0')
            self.assertEqual(sql("SELECT count(*) FROM business_sources WHERE description<>'' OR name<>'内容已按退出期限清理'"),'0')
            self.assertEqual(sql("SELECT count(*) FROM business_source_config_versions WHERE settings->>'description'<>''"),'0')
            self.assertEqual(sql("SELECT count(*) FROM business_source_submissions WHERE note<>''"),'0')
            self.assertEqual(sql('SELECT status FROM ongoing_plans'),'STOPPED')
            self.assertEqual(sql("SELECT configuration->>'query' FROM ongoing_plan_versions"),'')
            self.assertEqual(sql("SELECT receipt#>>'{configuration,query}' FROM ongoing_plan_receipts"),'')
            self.assertEqual(sql('SELECT title FROM conversations'),'内容已按退出期限清理')
            self.assertEqual(sql('SELECT count(*) FROM conversation_tasks WHERE public_query IS NOT NULL'),'0')
            self.assertEqual(sql('SELECT warnings FROM knowledge_runs'),'')
            self.assertEqual(sql('SELECT filename FROM document_publications'),'removed')
            self.assertEqual(sql('SELECT presentation::text FROM recommendation_presentations'),'{}')
            self.assertEqual(sql('SELECT enabled FROM recommendation_settings'),'f')
            self.assertEqual(sql("SELECT receipt->>'enabled' FROM recommendation_receipts"),'false')
            if backup_recovery.has_table(sql,'task_plan_checks'):
                self.assertEqual(sql("SELECT scrubbed AND reason='' AND state='CANCELLED' FROM task_plan_checks"),'t')

    def test_offboard_residual_keeps_shared_enterprise_assets(self):
        with backup.offline_database(self.source) as (_,__,sql):self.residual_fixture(sql)
        bundle,restored=self.root/'bundle',self.root/'restored'
        backup.create(self.source,bundle,self.key)
        with backup.offline_database(self.source) as (_,__,sql):
            self.departure(sql,200,'MEMBER_OFFBOARD','CLEANING',ident(1))
            sql("UPDATE departure_executions SET effective_at=now()-interval '31 days',deadline=now()-interval '1 day',stop_complete=true")
        backup.restore(bundle,restored,self.key);backup_recovery.activate(restored,self.source,self.key)
        with backup.offline_database(restored) as (_,__,sql):
            self.assertEqual(sql(f"SELECT value FROM profile_versions WHERE id='{ident(301)}'"),'')
            self.assertEqual(sql(f"SELECT value FROM profile_versions WHERE id='{ident(326)}'"),'')
            self.assertEqual(sql(f"SELECT value FROM profile_versions WHERE id='{ident(316)}'"),'space profile')
            self.assertEqual(sql(f"SELECT value FROM profile_versions WHERE id='{ident(71)}'"),'old business goal')
            self.assertEqual(sql(f"SELECT description FROM business_sources WHERE id='{ident(320)}'"),'')
            self.assertEqual(sql(f"SELECT description FROM business_sources WHERE id='{ident(310)}'"),'sensitive description')
            self.assertEqual(sql('SELECT filename FROM document_publications'),'independent.pdf')
            self.assertEqual(sql('SELECT warnings FROM knowledge_runs'),'private diagnostic warning')
            self.assertEqual(sql('SELECT status FROM ongoing_plans'),'STOPPED')
            self.assertEqual(sql('SELECT status FROM tenant_memberships'),'DISABLED')
            if backup_recovery.has_table(sql,'task_plan_checks'):
                self.assertEqual(sql("SELECT scrubbed AND reason='' AND state='CANCELLED' FROM task_plan_checks"),'t')

    def test_missing_authority_and_schema_drift_cannot_reconcile(self):
        bundle,restored = self.root/'bundle',self.root/'restored'
        backup.create(self.source,bundle,self.key); backup.restore(bundle,restored,self.key)
        registry = next((self.root/'keys').glob('source-*.json'))
        saved = registry.read_bytes(); registry.unlink()
        with self.assertRaises((trial.TrialError,OSError)): backup_recovery.reconcile(restored,self.source,self.key)
        registry.write_bytes(saved); registry.chmod(0o600)
        with backup.offline_database(self.source) as (_,__,sql): sql('CREATE TABLE future_uncovered_control(id uuid)')
        with self.assertRaisesRegex(trial.TrialError,'未纳入'): backup_recovery.reconcile(restored,self.source,self.key)
        with self.assertRaises(trial.TrialError): trial.start(restored)
        with backup.offline_database(self.source) as (_,__,sql): sql('DROP TABLE future_uncovered_control; ALTER TABLE accounts ADD COLUMN unexpected_policy boolean DEFAULT true')
        with self.assertRaisesRegex(trial.TrialError,'已核验结构'):backup_recovery.reconcile(restored,self.source,self.key)


if __name__=='__main__': unittest.main()

"""Fixed tenant reset. Requires stopped Dreamcore services and a validated fresh import.
Never executes against the source 9POP database. Backups remain outside the active stores.
"""
import hashlib,json,pathlib,sqlite3,subprocess
E=pathlib.Path('/var/lib/dreamcore/deploy-evidence/ninepop-reconnect-20261016')
B=pathlib.Path('/var/lib/dreamcore/deploy-evidence/metric-pagination-20261016')
T='951228cb-58d8-474f-b784-55f5b946e81a'
PG=['docker','exec','dreamcore-app-check-20261010','psql','-U','dreamcore_migration_check','-d','dreamcore_trial','-At','-v','ON_ERROR_STOP=1','-c']
assert not (E/'cutover-completed.json').exists(),'Reset already executed'
assert subprocess.run(['systemctl','is-active','dreamcore-app-rehearsal','dreamcore-wiki','dreamcore-model-engine'],capture_output=True,text=True).stdout.strip().splitlines()==['inactive']*3
assert (B/'database-cutover.dump').stat().st_size>1000000 and (B/'wiki-cutover.db').stat().st_size>1000000
report=json.loads((E/'staged-import.json').read_text());assert report['imported']==report['compatibleDefinitions']==report['currentVersions']==106
# Validate the staged SQLite without touching the running store.
source=sqlite3.connect('file:'+str(E/'staging/mengine.db')+'?mode=ro',uri=True)
assert source.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
assert not source.execute('PRAGMA foreign_key_check').fetchall()
live=sqlite3.connect('/var/lib/dreamcore/wiki-data/mengine.db')
keep={'tenants','users','sessions','departments','database_connections','platform_tenant_bindings','platform_actor_bindings','access_migrations','platform_bridge_nonces'}
def rows(db,t,where='',args=()):return sorted(db.execute('SELECT * FROM "'+t+'"'+where,args).fetchall(),key=repr)
def digest(value):return hashlib.sha256(repr(value).encode()).hexdigest()
for name in ['tenants','users','departments','database_connections','platform_tenant_bindings','platform_actor_bindings']:
 cols={r[1] for r in live.execute('PRAGMA table_info("'+name+'")')}
 where=' WHERE tenant_id=?' if 'tenant_id' in cols else (' WHERE platform_tenant=?' if 'platform_tenant' in cols else ' WHERE id=?')
 assert rows(live,name,where,(T,))==rows(source,name,where,(T,)),name+' changed while preparing'
for db in [live,source]:
 jobs={r[0]:json.loads(r[1]) for r in db.execute('SELECT id,data FROM database_sync_jobs WHERE tenant_id=?',(T,))}
 state={k:{f:j.get(f) for f in ['connectionId','datasetId','table','centsToYuan','intervalMinutes','enabled','actorId']} for k,j in jobs.items()}
 if db is live:originalJobs=state
 else:assert state==originalJobs,'Sync configuration changed'
for row in live.execute('SELECT id,data FROM documents WHERE tenant_id=?',(T,)):
 fresh=source.execute('SELECT data FROM documents WHERE id=? AND tenant_id=?',(row[0],T)).fetchone();assert fresh
 a,b=json.loads(row[1]),json.loads(fresh[0]);assert all(a.get(k)==b.get(k) for k in ['ownerId','classification','audience','grants','departmentId','policyVersion','restrictedContent']),'Asset permissions changed'
tables=[r[0] for r in live.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
unaffected={}
for name in tables:
 cols={r[1] for r in live.execute('PRAGMA table_info("'+name+'")')}
 if name in keep:unaffected[name]=digest(rows(live,name))
 elif 'tenant_id' in cols:unaffected[name]=digest(rows(live,name,' WHERE tenant_id<>? OR tenant_id IS NULL',(T,)))
# Materialize and verify the merged result in a disposable copy before committing the PG reset.
merged=E/'wiki-merged.db';assert not merged.exists()
copy=sqlite3.connect(merged);live.backup(copy)
def merge(db):
 db.execute('PRAGMA foreign_keys=OFF');db.execute('BEGIN IMMEDIATE')
 db.execute('DELETE FROM conversation_turns WHERE conversation_id IN(SELECT id FROM conversations WHERE tenant_id=?)',(T,));db.execute('DELETE FROM conversation_titles WHERE id IN(SELECT id FROM conversations WHERE tenant_id=?)',(T,))
 for name in tables:
  if name in keep:continue
  cols={r[1] for r in db.execute('PRAGMA table_info("'+name+'")')}
  if 'tenant_id' not in cols:continue
  db.execute('DELETE FROM "'+name+'" WHERE tenant_id=?',(T,))
  data=rows(source,name,' WHERE tenant_id=?',(T,))
  if data:db.executemany('INSERT INTO "'+name+'" VALUES('+','.join('?' for _ in data[0])+')',data)
 assert not db.execute('PRAGMA foreign_key_check').fetchall()
 for name,expected in unaffected.items():
  actual=digest(rows(db,name)) if name in keep else digest(rows(db,name,' WHERE tenant_id<>? OR tenant_id IS NULL',(T,)))
  assert actual==expected,'Unrelated SQLite rows changed: '+name
 db.commit();db.execute('PRAGMA foreign_keys=ON')
merge(copy);assert copy.execute('PRAGMA integrity_check').fetchone()[0]=='ok';copy.close()
plan=(E/'reset-plan.sql').read_text()
mutation=r"""
CREATE TEMP TABLE survivor_hash(rel oid PRIMARY KEY,hash text) ON COMMIT DROP;
DO $$ DECLARE r record;h text; BEGIN
 FOR r IN SELECT c.oid,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' LOOP
  EXECUTE format('SELECT md5(coalesce(string_agg(row_to_json(t)::text,E''\n'' ORDER BY t.ctid),'''')) FROM %I t WHERE NOT EXISTS(SELECT 1 FROM wipe_rows w WHERE w.rel=%s AND w.pos=t.ctid)',r.relname,r.oid) INTO h;
  INSERT INTO survivor_hash VALUES(r.oid,h);
 END LOOP;
END $$;
SET LOCAL session_replication_role=replica;
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT DISTINCT w.rel,c.relname FROM wipe_rows w JOIN pg_class c ON c.oid=w.rel LOOP
  EXECUTE format('DELETE FROM %I t USING wipe_rows w WHERE w.rel=%s AND w.pos=t.ctid',r.relname,r.rel);
 END LOOP;
END $$;
SET LOCAL session_replication_role=origin;
DO $$ DECLARE r record;h text;clause text;nonnull text;bad boolean;BEGIN
 FOR r IN SELECT s.*,c.relname FROM survivor_hash s JOIN pg_class c ON c.oid=s.rel LOOP
  EXECUTE format('SELECT md5(coalesce(string_agg(row_to_json(t)::text,E''\n'' ORDER BY t.ctid),'''')) FROM %I t',r.relname) INTO h;
  IF h<>r.hash THEN RAISE EXCEPTION 'Retained rows changed: %',r.relname;END IF;
 END LOOP;
 FOR r IN SELECT c.*,p.relname parent,ch.relname child FROM pg_constraint c JOIN pg_class p ON p.oid=c.confrelid JOIN pg_class ch ON ch.oid=c.conrelid JOIN pg_namespace ns ON ns.oid=ch.relnamespace WHERE c.contype='f' AND ns.nspname='public' LOOP
  SELECT string_agg(format('ch.%I=p.%I',a.attname,b.attname),' AND '),string_agg(format('ch.%I IS NOT NULL',a.attname),' AND ') INTO clause,nonnull FROM unnest(r.conkey,r.confkey) k(ak,bk) JOIN pg_attribute a ON a.attrelid=r.conrelid AND a.attnum=k.ak JOIN pg_attribute b ON b.attrelid=r.confrelid AND b.attnum=k.bk;
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I ch WHERE %s AND NOT EXISTS(SELECT 1 FROM %I p WHERE %s))',r.child,nonnull,r.parent,clause) INTO bad;
  IF bad THEN RAISE EXCEPTION 'Orphaned reference: %',r.conname;END IF;
 END LOOP;
END $$;
UPDATE scene_bindings SET source_revision='',governance_valid_until=NULL WHERE tenant_id='951228cb-58d8-474f-b784-55f5b946e81a';
UPDATE metric_generation_settings SET checked_at=NULL,created_count=0,error_code=NULL WHERE tenant_id='951228cb-58d8-474f-b784-55f5b946e81a';
UPDATE briefing_generation_policies SET data_key=NULL,context_key=NULL,info_day=NULL,checked_at=NULL,reason=NULL WHERE tenant_id='951228cb-58d8-474f-b784-55f5b946e81a';
INSERT INTO identity_audit(actor_id,tenant_id,action,target_id,outcome,request_id) SELECT maintainer_id,tenant_id,'TENANT_TEST_DATA_RESET',tenant_id,'SUCCESS','fe70036f-7453-48da-b9ca-4df71ad3b5c4' FROM scene_bindings WHERE tenant_id='951228cb-58d8-474f-b784-55f5b946e81a';
COMMIT;
"""
sql=plan.replace('-- EXECUTION_POINT: reviewed scoped deletes are added only for the stopped-service cutover.\nROLLBACK;',mutation)
(E/'reset-executed.sql').write_text(sql)
preview=sql.rsplit('COMMIT;',1)[0]+'ROLLBACK;'
p=subprocess.run(PG+[preview],capture_output=True,text=True);(E/'reset-rollback-rehearsal.log').write_text(p.stdout+p.stderr);p.check_returncode()
p=subprocess.run(PG+[sql],capture_output=True,text=True);(E/'reset-execution.log').write_text(p.stdout+p.stderr);p.check_returncode()
# No app process can write between these stores. The old SQLite and PG checkpoint remain recoverable.
merge(live);live.execute('PRAGMA wal_checkpoint(TRUNCATE)');live.close();source.close()
(E/'cutover-completed.json').write_text(json.dumps({'tenant':T,'freshTables':106,'freshRows':report['rows'],'preservedSQLiteHashes':unaffected,'pgSurvivorHashesVerified':True,'foreignKeysVerified':True},indent=2))
print('Tenant reset committed; fresh source snapshots installed; identities and unrelated rows verified unchanged')

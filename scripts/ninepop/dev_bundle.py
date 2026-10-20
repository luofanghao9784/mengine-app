#!/usr/bin/env python3
"""Private, frozen 9POP developer handoff. Not a production backup or cloud connector.
Export only after stopping trial.py. Restore only into a NEW local directory.
"""
import argparse, hashlib, json, os, pathlib, secrets, shutil, sqlite3, subprocess, sys, tarfile, tempfile, uuid
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'local'))
import trial, backup, backup_recovery
P = pathlib.Path
TENANT = '04b44066-ceb7-46dd-af0b-f5328cc6ceb3'

def run(args, env=None):
    r = subprocess.run([str(x) for x in args], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if r.returncode: raise RuntimeError('Local command failed: '+P(str(args[0])).name+'; private diagnostic: '+r.stderr.decode(errors='replace')[-1200:])
    return r.stdout.decode().strip()

def pg_args(root, database):
    c=trial.private_read(root/'config.json')
    return ['-h','127.0.0.1','-p',str(c['ports']['database']),'-U','dreamcore_trial','-d',database]

def env(root):
    return {**trial.clean_environment(),'PGPASSWORD':trial.private_read(root/'database.json')['password']}

def sql(root, database, statement):
    return run([backup.pg('psql'),*pg_args(root,database),'-At','-v','ON_ERROR_STOP=1','-c',statement],env(root))

def start_pg(root):
    port=trial.private_read(root/'config.json')['ports']['database']
    run([backup.pg('pg_ctl'),'-D',root/'postgres','-o',f'-h 127.0.0.1 -p {port} -k /tmp','-l',root/'handoff-postgres.log','-w','start'],trial.clean_environment())

def stop_pg(root):
    run([backup.pg('pg_ctl'),'-D',root/'postgres','-m','fast','-w','stop'],trial.clean_environment())

def write(path,value):
    path.parent.mkdir(parents=True,exist_ok=True);trial.private_write(path,value)

def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def scrub_connection(v):
    if isinstance(v,dict):
        return {k:('' if any(w in k.lower() for w in ['password','secret','token','apikey','credential']) else False if k in ['enabled','autoEnabled'] else scrub_connection(z)) for k,z in v.items()}
    if isinstance(v,list):return [scrub_connection(x) for x in v]
    return v

SCRUB = """
DELETE FROM spring_session_attributes; DELETE FROM spring_session;
DELETE FROM platform_sessions; DELETE FROM phone_challenges;
DELETE FROM headquarters_support_access;
UPDATE accounts SET password_hash='!DEVELOPER_IMPORT_REQUIRED!';
UPDATE platform_accounts SET password_hash='!DEVELOPER_IMPORT_REQUIRED!';
UPDATE invitations SET token_hash='disabled-'||id::text,expires_at=now(),status=CASE WHEN status='PENDING' THEN 'REVOKED' ELSE status END;
UPDATE platform_staff_invitations SET token_hash='disabled-'||id::text,status=CASE WHEN status='PENDING' THEN 'REVOKED' ELSE status END;
UPDATE conversation_tasks SET status=CASE WHEN status IN ('QUEUED','RUNNING') THEN 'PAUSED' ELSE status END,lease_token=NULL,lease_until=NULL;
UPDATE conversation_attempts SET status='RESULT_UNKNOWN',finished_at=now() WHERE status='RUNNING';
UPDATE data_connections SET auto_enabled=false,next_due=NULL;
UPDATE collection_runs SET lease_token=NULL,lease_until=NULL,status='FAILED',reason='DEVELOPER_HANDOFF' WHERE status IN ('QUEUED','RUNNING');
UPDATE briefing_generation_policies SET enabled=false;
UPDATE briefing_daily_schedules SET enabled=false;
UPDATE ongoing_plans SET status='PAUSED',next_due=NULL WHERE status='ACTIVE';
UPDATE knowledge_runs SET status='CANCELLED',lease_token=NULL,lease_until=NULL WHERE status IN ('QUEUED','RUNNING');
DELETE FROM briefing_reading_snapshots;
"""

def export(root, output):
    if output.exists():raise RuntimeError('Refuse to overwrite bundle')
    if (root/'postgres/postmaster.pid').exists():raise RuntimeError('Stop the local trial first; export requires stopped services')
    output.parent.mkdir(parents=True,exist_ok=True)
    scratch='handoff_'+uuid.uuid4().hex
    start_pg(root)
    try:
      if sql(root,'dreamcore_trial','SELECT count(*) FROM tenants')!='1' or sql(root,'dreamcore_trial','SELECT id FROM tenants')!=TENANT:raise RuntimeError('Only the isolated 9POP trial is supported')
      with tempfile.TemporaryDirectory(prefix='ninepop-handoff-') as tmp:
        tmp=P(tmp);payload=tmp/'payload';payload.mkdir()
        raw=tmp/'original.dump'
        run([backup.pg('pg_dump'),*pg_args(root,'dreamcore_trial'),'-Fc','--no-owner','--no-acl','-f',raw],env(root))
        sql(root,'postgres','CREATE DATABASE '+scratch)
        run([backup.pg('pg_restore'),*pg_args(root,scratch),'--no-owner','--no-acl','--exit-on-error',raw],env(root))
        sql(root,scratch,'BEGIN;'+SCRUB+'COMMIT;')
        assert sql(root,scratch,"SELECT count(*) FROM accounts WHERE password_hash<>'!DEVELOPER_IMPORT_REQUIRED!'")=='0'
        run([backup.pg('pg_dump'),*pg_args(root,scratch),'-Fc','--no-owner','--no-acl','-f',payload/'database.dump'],env(root))
        (payload/'scene').mkdir()
        source=sqlite3.connect(f'file:{root}/scene/mengine.db?mode=ro',uri=True);target=sqlite3.connect(payload/'scene/mengine.db');source.backup(target);source.close()
        target.execute("UPDATE users SET password_hash='!DEVELOPER_IMPORT_REQUIRED!'")
        target.execute('DELETE FROM sessions');target.execute('DELETE FROM platform_bridge_nonces');target.execute('DELETE FROM source_leases')
        for ident,data in target.execute('SELECT id,data FROM database_connections').fetchall():
            clean=scrub_connection(json.loads(data));target.execute('UPDATE database_connections SET data=? WHERE id=?',(json.dumps(clean,ensure_ascii=False),ident))
        target.commit();target.execute('VACUUM');target.close()
        if any(f.is_symlink() for f in (root/'objects').rglob('*')):raise RuntimeError('Object symlinks rejected')
        shutil.copytree(root/'objects',payload/'objects')
        for f in ['onboarding-recipe.json','sources/authorized-manifest.json','first-collection-20261019/binding-manifest.json']:
            dest=payload/f;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(root/f,dest)
        counts={t:int(sql(root,scratch,'SELECT count(*) FROM '+t)) for t in ['accounts','workspaces','business_datasets','dataset_snapshots','conversation_tasks','scene_asset_links']}
        files={str(f.relative_to(payload)):digest(f) for f in payload.rglob('*') if f.is_file()}
        write(payload/'manifest.json',{'format':'ninepop-dev-v1','tenantId':TENANT,'counts':counts,'files':files,'cloudConnectionsEnabled':False,'credentialsIncluded':False,'dataCutoff':'2026-10-19','note':'Private authorized business data; no cloud fetch. Original permissions retained.'})
        with tarfile.open(output,'w:gz') as tar:
            for f in sorted(payload.rglob('*')):
                if f.is_symlink():raise RuntimeError('Symlink rejected')
                if f.is_file():tar.add(f,arcname=str(f.relative_to(payload)))
        output.chmod(0o600)
        print(json.dumps({'bundle':str(output),'sha256':digest(output),'bytes':output.stat().st_size,'counts':counts}))
    finally:
      sql(root,'postgres','DROP DATABASE IF EXISTS '+scratch)
      stop_pg(root)

def restore(bundle,root,expected):
    if root.exists():raise RuntimeError('Destination must not exist; existing data is never overwritten')
    if digest(bundle)!=expected:raise RuntimeError('Bundle checksum mismatch')
    root.mkdir(parents=True,mode=0o700)
    with tarfile.open(bundle) as tar:
        for m in tar.getmembers():
            if not m.isfile() or m.name.startswith('/') or '..' in P(m.name).parts:raise RuntimeError('Unsafe archive member')
        tar.extractall(root,filter='data')
    manifest=json.loads((root/'manifest.json').read_text())
    if manifest['format']!='ninepop-dev-v1' or manifest['tenantId']!=TENANT:raise RuntimeError('Wrong bundle')
    for name,sha in manifest['files'].items():
        if P(name).is_absolute() or '..' in P(name).parts:raise RuntimeError('Unsafe manifest path')
        if digest(root/name)!=sha:raise RuntimeError('File checksum mismatch')
    for f in root.rglob('*'):
        if f.is_file():f.chmod(0o600)
    ports=set()
    while len(ports)<3:ports.add(trial.free_port())
    database_port,api,web=sorted(ports)
    write(root/'config.json',{'format':trial.FORMAT,'workspace':str(trial.WORKSPACE),'agentMode':'off','ports':{'database':database_port,'api':api,'web':web}})
    secret=secrets.token_urlsafe(32);write(root/'database.json',{'password':secret})
    pw=root/'init-password';pw.write_text(secret);pw.chmod(0o600)
    try:run([backup.pg('initdb'),'-D',root/'postgres','-U','dreamcore_trial','--pwfile',pw,'--auth=scram-sha-256','--encoding=UTF8','--locale=C'])
    finally:pw.unlink(missing_ok=True)
    with (root/'postgres/postgresql.conf').open('a') as f:f.write(f"\nlisten_addresses='127.0.0.1'\nport={database_port}\n")
    start_pg(root)
    try:
        sql(root,'postgres','CREATE DATABASE dreamcore_trial')
        run([backup.pg('pg_restore'),*pg_args(root,'dreamcore_trial'),'--no-owner','--no-acl','--exit-on-error',root/'database.dump'],env(root))
        sql(root,'dreamcore_trial','ANALYZE')
        accounts=json.loads(sql(root,'dreamcore_trial',"SELECT json_agg(row_to_json(x)) FROM (SELECT id,phone,email,display_name FROM accounts WHERE status='ACTIVE') x"))
        credentials=[]
        for account in accounts:
            password=secrets.token_urlsafe(18)
            sql(root,'dreamcore_trial',"UPDATE accounts SET password_hash="+backup_recovery.literal(backup_recovery.password_hash(password))+" WHERE id='"+account['id']+"'")
            credentials.append({**account,'password':password})
        platform=json.loads(sql(root,'dreamcore_trial','SELECT json_agg(row_to_json(x)) FROM (SELECT account_id,login_name FROM platform_accounts) x'))
        for a in platform or []:
            a['password']=secrets.token_urlsafe(20);a['realm']='platform';a['loginName']=a.pop('login_name')
            sql(root,'dreamcore_trial',"UPDATE platform_accounts SET password_hash="+backup_recovery.literal(backup_recovery.password_hash(a['password']))+" WHERE account_id='"+a['account_id']+"'")
        write(root/'accounts.json',{'platform':platform[0],'members':credentials})
        write(root/'scene-private.json',{'tenant':TENANT,'key':secrets.token_urlsafe(48)})
        # Database-side connector secrets remain empty; no collector registry or model settings are restored.
        for t,count in manifest['counts'].items():
            if int(sql(root,'dreamcore_trial','SELECT count(*) FROM '+t))!=count:raise RuntimeError('Restored row count mismatch: '+t)
    finally:stop_pg(root)
    print(json.dumps({'directory':str(root),'accountsFile':str(root/'accounts.json'),'start':'python3 scripts/local/trial.py start --directory '+str(root)+' --phone-local','cloudEnabled':False},ensure_ascii=False))

if __name__=='__main__':
    os.umask(0o077)
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('command',choices=['export','restore']);p.add_argument('--directory',type=P,required=True);p.add_argument('--bundle',type=P,required=True);p.add_argument('--sha256');a=p.parse_args()
    if a.command=='export':export(a.directory.resolve(),a.bundle.resolve())
    else:
        if not a.sha256:p.error('restore requires --sha256 from the Git handoff document')
        restore(a.bundle.resolve(),a.directory.resolve(),a.sha256)

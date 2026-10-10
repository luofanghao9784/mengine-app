#!/usr/bin/env python3
"""Synthetic forward migration and pre-cutover snapshot restore on with-test-postgres only."""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.parse import urlparse

root = Path(__file__).resolve().parents[1]
url = urlparse(os.environ['DATABASE_URL'].removeprefix('jdbc:'))
assert url.hostname == '127.0.0.1' and url.path == '/dreamcore_test'
env = {**os.environ, 'PGPASSWORD': os.environ['DATABASE_PASSWORD']}
args = ['-h', url.hostname, '-p', str(url.port), '-U', os.environ['DATABASE_USER']]

def run(cmd, **kw):
    value = subprocess.run(cmd, env=env, capture_output=True, text=True, **kw)
    if value.returncode:
        raise RuntimeError(f'Synthetic migration command failed: {Path(cmd[0]).name}; {value.stderr[:1200]}')
    return value.stdout.strip()

def sql(query, database='dreamcore_test'):
    return run(['psql', '-X', *args, '-d', database, '-At', '-v', 'ON_ERROR_STOP=1'], input=query)

migrations = sorted((root/'apps/api/src/main/resources/db/migration').glob('V*__*.sql'), key=lambda p: int(re.match(r'V(\d+)', p.name)[1]))
for migration in migrations:
    if int(re.match(r'V(\d+)', migration.name)[1]) <= 98:
        sql(migration.read_text())
p, c, t = ['00000000-0000-4000-8000-00000000000' + x for x in ('1', '2', '3')]
sql(f"""INSERT INTO accounts(id,email,display_name,password_hash) VALUES('{p}','legacy-platform@identity.invalid','Synthetic platform','!NO_COMMON!');
INSERT INTO accounts(id,phone,phone_verified_at,display_name,password_hash) VALUES('{c}','+8619900110099',now(),'Synthetic customer','synthetic-unified-hash');
INSERT INTO platform_accounts(account_id,login_name,password_hash) VALUES('{p}','+8619900110099','synthetic-dedicated-hash');
INSERT INTO platform_roles VALUES('{p}','PLATFORM_ADMIN');
INSERT INTO tenants(id,name) VALUES('{t}','Historical ownerless tenant');
INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES('{t}','{c}','TENANT_ADMIN');
INSERT INTO identity_audit(actor_id,tenant_id,action,target_id,outcome) VALUES('{p}','{t}','TENANT_CREATE','{t}','SUCCESS');
INSERT INTO platform_sessions(token_hash,csrf_hash,account_id,credential_version,expires_at) VALUES(repeat('a',64),repeat('b',64),'{p}',0,now()+interval '1 hour');""")
with tempfile.TemporaryDirectory(prefix='dreamcore-migration-snapshot-') as folder:
    snapshot = Path(folder)/'before.dump'
    run(['pg_dump', *args, '-d', 'dreamcore_test', '-Fc', '-f', str(snapshot)])
    snapshot.chmod(0o600)
    for migration in migrations:
        if int(re.match(r'V(\d+)', migration.name)[1]) >= 99:
            sql(migration.read_text())
    assert sql('SELECT count(*) FROM accounts') == '2'
    assert sql('SELECT count(*) FROM unified_identity_links') == '0'
    assert sql('SELECT count(*) FROM platform_sessions') == '0'
    assert sql(f"SELECT password_hash FROM platform_accounts WHERE account_id='{p}'") == 'synthetic-dedicated-hash'
    assert sql(f"SELECT password_hash FROM accounts WHERE id='{c}'") == 'synthetic-unified-hash'
    assert sql('SELECT min(credential_version) FROM accounts') == '1'
    assert sql(f"SELECT status FROM tenants WHERE id='{t}'") == 'ACTIVE'
    assert sql(f"SELECT actor_id FROM identity_audit WHERE action='TENANT_CREATE'") == p
    assert sql('SELECT completed_at IS NOT NULL FROM platform_initialization') == 't'
    sql(f"INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES('{t}','{p}','MEMBER')")
    sql("CREATE DATABASE unified_rollback")
    run(['pg_restore', *args, '-d', 'unified_rollback', '--no-owner', '--no-acl', '--single-transaction', '--exit-on-error', str(snapshot)])
    assert sql('SELECT count(*) FROM accounts', 'unified_rollback') == '2'
    assert sql('SELECT count(*) FROM platform_sessions', 'unified_rollback') == '1'
    assert sql('SELECT min(credential_version) FROM accounts', 'unified_rollback') == '0'
    assert sql("SELECT to_regclass('unified_identity_links') IS NULL", 'unified_rollback') == 't'
print('PASS: populated pre-V99 forward migration, unchanged credentials/history, invalidated old sessions, no automatic merge, dual membership and isolated pre-cutover snapshot restore.')

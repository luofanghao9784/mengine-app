#!/usr/bin/env python3
"""Provision the explicitly authorized synthetic Meizu tenant in its empty local instance.
Read the password from the owner-only meizu-credentials.json, never from source/logs.
"""
import hashlib
import json
import os
import subprocess
import uuid
import trial

root = trial.WORKSPACE / '.local/meizu-demo'
config = trial.config(root)
state = trial.private_read(root / 'runtime.json')
assert config['agentMode'] == 'off' and state['state'] == 'ready'
assert state['webUrl'].startswith('http://127.0.0.1:')
credentials = trial.private_read(root / 'meizu-credentials.json')
assert credentials['username'] == 'meizu' and 6 <= len(credentials['password']) <= 128
secret = trial.private_read(root / 'database.json')['password']
def query(sql):
    result = subprocess.run([trial.binary('psql'), '-h', '127.0.0.1', '-p', str(config['ports']['database']),
        '-U', 'dreamcore_trial', '-d', 'dreamcore_trial', '-At', '-v', 'ON_ERROR_STOP=1'],
        input=sql, text=True, capture_output=True, env={**os.environ, 'PGPASSWORD': secret})
    if result.returncode:
        raise RuntimeError('Provisioning rejected; transaction rolled back. No credentials printed.')
    return result.stdout.strip()
assert query('SELECT count(*) FROM tenants') == '0', 'Only an empty isolated instance is allowed'
actor, tenant, personal = [str(uuid.uuid4()) for _ in range(3)]
salt = os.urandom(16)
encoded = '{pbkdf2-sha256-v1}' + (salt + hashlib.pbkdf2_hmac('sha256', credentials['password'].encode(), salt, 600000, 32)).hex()
spaces = [{'id': str(uuid.uuid4()), 'name': name} for name in ['经营管理', '招租运营', '租务与客户服务', '财务收缴', '工程与采购', '项目筹备']]
sql = f"""BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('meizu-demo-provision',0));
DO $$ BEGIN IF EXISTS(SELECT 1 FROM tenants) THEN RAISE EXCEPTION 'Instance not empty'; END IF; END $$;
INSERT INTO accounts(id,username,display_name,password_hash) VALUES ('{actor}','meizu','美租演示负责人','{encoded}');
INSERT INTO tenants(id,name) VALUES ('{tenant}','贵州美租企业管理集团有限公司（演示）');
INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES ('{tenant}','{actor}','TENANT_ADMIN');
INSERT INTO tenant_governance(tenant_id,owner_id) VALUES ('{tenant}','{actor}');
INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES ('{personal}','{tenant}','{actor}','个人资料','PERSONAL');
INSERT INTO identity_audit(actor_id,tenant_id,action,target_id,outcome) VALUES ('{actor}','{tenant}','DEMO_PROVISION','{tenant}','SUCCESS');
"""
for space in spaces:
    sql += f"INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES ('{space['id']}','{tenant}','{actor}','{space['name']}','SHARED');\n"
    sql += f"INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES ('{tenant}','{space['id']}','{actor}',true);\n"
query(sql + 'COMMIT;')
trial.private_write(root / 'meizu-provision.json', {'accountId': actor, 'tenantId': tenant, 'spaces': spaces,
    'personalWorkspaceId': personal, 'webUrl': state['webUrl'], 'synthetic': True, 'modelMode': 'off'})
print('Meizu synthetic tenant and seven workspaces provisioned; credentials remain private.')

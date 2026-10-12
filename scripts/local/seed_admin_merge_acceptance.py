#!/usr/bin/env python3
"""Seed only the named, fresh loopback merge acceptance instance with synthetic identities."""
import json, os, subprocess, uuid
from pathlib import Path
import trial
root=trial.WORKSPACE / '.local/admin-merge-acceptance-20261012'
config=trial.private_read(root/'config.json')
assert config['workspace']==str(trial.WORKSPACE) and config['agentMode']=='off'
state=trial.private_read(root/'runtime.json')
assert state['state']=='ready' and state['webUrl'].startswith('http://127.0.0.1:')
secret=trial.private_read(root/'database.json')['password']
psql=trial.binary('psql')
def query(sql):
    return subprocess.run([psql,'-h','127.0.0.1','-p',str(config['ports']['database']),'-U','dreamcore_trial','-d','dreamcore_trial','-At','-v','ON_ERROR_STOP=1'],input=sql,text=True,capture_output=True,check=True,env={**os.environ,'PGPASSWORD':secret}).stdout.strip()
assert query('SELECT count(*) FROM tenants')=='0', 'Seed only an empty synthetic acceptance instance'
actor,tenant,shared,personal=[str(uuid.uuid4()) for _ in range(4)]
query(f"""BEGIN;
INSERT INTO accounts(id,phone,phone_verified_at,display_name,password_hash) SELECT '{actor}','+8619900001012',now(),'合并验收负责人',password_hash FROM platform_accounts LIMIT 1;
INSERT INTO tenants(id,name) VALUES ('{tenant}','企业端合并验收（合成）');
INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES ('{tenant}','{actor}','TENANT_ADMIN');
INSERT INTO tenant_governance(tenant_id,owner_id) VALUES ('{tenant}','{actor}');
INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES ('{shared}','{tenant}','{actor}','合成验收资料','SHARED'),('{personal}','{tenant}','{actor}','个人资料','PERSONAL');
INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES ('{tenant}','{shared}','{actor}',true);
COMMIT;""")
accounts=trial.private_read(root/'accounts.json')
accounts['enterprise']={'phone':'19900001012','password':accounts['platform']['password'],'tenantId':tenant,'workspaceId':shared,'synthetic':True}
trial.private_write(root/'accounts.json',accounts)
trial.private_write(root/'acceptance.json',{'tenantId':tenant,'workspaceId':shared,'url':state['webUrl']+'/tenant-admin/#tenant='+tenant,'synthetic':True})
print('Synthetic acceptance identities ready; credentials remain in the private accounts.json.')

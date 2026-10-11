#!/usr/bin/env python3
"""One-time existing V108 instance manual-model rollout. Run as root on the host.
prepare reads project-owned model JSON from stdin (never command-line credentials).
activate performs no schema/data edits; rollback preserves post-activation user data.
"""
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import time
import urllib.request
import zipfile

ROOT = Path('/var/lib/dreamcore/app-check-20261010')
LIVE = Path('/var/lib/dreamcore/model-live-20261011')
EVIDENCE = Path('/var/lib/dreamcore/deploy-evidence/model-live-20261011')
STAGE = Path('/tmp/dreamcore-node-20261011')
NODE = '/opt/dreamcore/node-v24.20.0-linux-x64/bin/node'
API_UNIT = 'dreamcore-app-rehearsal.service'
ENGINE_UNIT = 'dreamcore-model-engine.service'
CONTAINER = 'dreamcore-app-check-20261010'

def run(*args, **kwargs):
    return subprocess.check_output(args, stderr=subprocess.PIPE, **kwargs)

def sql(query):
    return run('docker','exec',CONTAINER,'psql','-U','dreamcore_migration_check','-d','dreamcore_trial','-Atc',query).decode().strip()

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def env_read(path):
    return dict(line.split('=',1) for line in path.read_text().splitlines() if '=' in line and not line.startswith('#'))

def env_write(path, values):
    # systemd EnvironmentFile double-quoted escaping; no shell evaluates this file.
    def quote(v):
        assert '\n' not in v and '\r' not in v and '\0' not in v
        return '"'+v.replace('\\','\\\\').replace('"','\\"').replace('`','\\`').replace('$','\\$')+'"'
    path.write_text(''.join(k+'='+quote(str(v))+'\n' for k,v in values.items()))
    path.chmod(0o600)

def migrations(path):
    with zipfile.ZipFile(path) as z:
        return {n:hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist() if '/db/migration/' in n and n.endswith('.sql')}

def no_pending():
    assert sql("SELECT count(*) FROM conversation_tasks WHERE status IN ('QUEUED','RUNNING')") == '0', 'Active conversation tasks require review'
    assert sql("SELECT count(*) FROM conversation_titles WHERE state IN ('QUEUED','RUNNING')") == '0', 'Pending title tasks require review'

def health(url):
    for _ in range(90):
        try:
            with urllib.request.urlopen(url,timeout=2) as r:
                if r.status==200:return
        except Exception:pass
        time.sleep(1)
    raise RuntimeError('Health did not become ready')

def prepare():
    model=json.load(sys.stdin)
    assert model['provider']=='bailian' and model['model']=='qwen3.7-plus-2026-05-26'
    assert model['apiKey'] and model['workspaceId']
    assert not LIVE.exists() and not EVIDENCE.exists(), 'Existing rollout must be inspected, not overwritten'
    assert sql('SELECT max(version::int) FROM flyway_schema_history WHERE success')=='108'
    no_pending()
    assert migrations(ROOT/'release/api.jar')==migrations(STAGE/'workspace-api-0.1.0-SNAPSHOT.jar'), 'Migration mismatch'
    LIVE.mkdir(mode=0o755); LIVE.chmod(0o755); EVIDENCE.mkdir(mode=0o700)
    release=LIVE/'engine';release.mkdir(mode=0o755)
    run('tar','-xzf',str(STAGE/'engine.tar.gz'),'-C',str(release))
    run('/opt/dreamcore/node-v24.20.0-linux-x64/bin/npm','ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund',cwd=release,env={**os.environ,'PATH':str(Path(NODE).parent)+':/usr/bin:/bin'})
    run('chmod','-R','a+rX',str(release))
    run('runuser','-u','dreamcore','--',NODE,'--input-type=module','-e',
        "import { TrustedCatalog } from './dist/runtime/catalog.js'; const c=await TrustedCatalog.load(); const tools=new Set(c.items.flatMap(i=>i.tools)); for(const i of c.items) await c.activate(i.id,i.version,tools); console.log('catalog verified');",cwd=release)
    token=secrets.token_hex(32)
    values={'ENGINE_HOST':'127.0.0.1','ENGINE_PORT':'18482','TASK_ENGINE_TOKEN':token,
            'AGENT_PLATFORM_URL':'http://127.0.0.1:18481',
            'AGENT_MODEL_PROVIDER':'bailian','AGENT_MODEL_NAME':model['model'],
            'AGENT_BAILIAN_WORKSPACE_ID':model['workspaceId'],'AGENT_MODEL_API_KEY':model['apiKey'],
            'AGENT_PUBLIC_WEB_ENABLED':'false','NODE_OPTIONS':'--max-old-space-size=384'}
    env_write(LIVE/'engine.env',values)
    shutil.copy2(ROOT/'api.env',EVIDENCE/'api-before.env')
    shutil.copy2(ROOT/'release/api.jar',EVIDENCE/'api-before.jar')
    shutil.copy2('/etc/systemd/system/'+API_UNIT,EVIDENCE/'api-before.service')
    (EVIDENCE/'database-before.dump').write_bytes(run('docker','exec',CONTAINER,'pg_dump','-U','dreamcore_migration_check','-d','dreamcore_trial','-Fc'))
    # Run under the same account and resource envelope used by the engine. No tenant data.
    unit=f'''[Unit]
Description=Dreamcore live model engine
After=network-online.target
[Service]
Type=exec
User=dreamcore
Group=dreamcore
WorkingDirectory={release}
EnvironmentFile={LIVE}/engine.env
ExecStart={NODE} {release}/dist/main.js
Restart=on-failure
RestartSec=5
UMask=0077
MemoryMax=640M
MemorySwapMax=0
CPUQuota=50%
TasksMax=128
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
[Install]
WantedBy=multi-user.target
'''
    Path('/etc/systemd/system/'+ENGINE_UNIT).write_text(unit)
    run('systemctl','daemon-reload')
    report=json.loads(run('systemd-run','--quiet','--wait','--pipe','--collect','--unit=dreamcore-model-smoke-20261011',
        '-p','User=dreamcore','-p','Group=dreamcore','-p','EnvironmentFile='+str(LIVE/'engine.env'),
        '-p','MemoryMax=640M','-p','CPUQuota=50%','-p','ProtectSystem=strict','-p','ProtectHome=yes','-p','PrivateTmp=yes',
        NODE,str(release/'scripts/live-model-smoke.mjs')))
    assert report['liveVerified'] is True
    (EVIDENCE/'smoke.json').write_text(json.dumps(report))
    run('systemctl','start',ENGINE_UNIT);health('http://127.0.0.1:18482/healthz')
    req=urllib.request.Request('http://127.0.0.1:18482/internal/v1/runtime',headers={'Authorization':'Bearer '+token})
    descriptor=json.load(urllib.request.urlopen(req,timeout=5))
    assert descriptor['runtimeMode']=='agent-live' and descriptor['engineVersion']=='0.19.0'
    (EVIDENCE/'runtime.json').write_text(json.dumps(descriptor))
    manifest={'apiSha256':digest(STAGE/'workspace-api-0.1.0-SNAPSHOT.jar'),'engineArchiveSha256':digest(STAGE/'engine.tar.gz'),
              'databaseBackupSha256':digest(EVIDENCE/'database-before.dump'),'model':model['model']}
    (EVIDENCE/'prepared.json').write_text(json.dumps(manifest,indent=2))
    print(json.dumps({'prepared':True,'smoke':report,'runtime':descriptor}))

def activate():
    assert (EVIDENCE/'prepared.json').exists() and not (EVIDENCE/'active.json').exists()
    values=env_read(ROOT/'api.env');assert values['TASK_ENABLED']=='false' and values['AGENT_TASK_MODE']=='off'
    assert digest(STAGE/'workspace-api-0.1.0-SNAPSHOT.jar')==json.loads((EVIDENCE/'prepared.json').read_text())['apiSha256']
    health('http://127.0.0.1:18482/healthz')
    limits=json.loads(run('docker','inspect','--format','{{json .HostConfig}}',CONTAINER))
    (EVIDENCE/'database-limits-before.json').write_text(json.dumps({k:limits[k] for k in ('NanoCpus','Memory','MemorySwap')}))
    run('docker','update','--cpus','1','--memory','1g','--memory-swap','1g',CONTAINER)
    # Stop API before final queue guard/snapshot. No old work is silently resumed.
    run('systemctl','stop',API_UNIT)
    try:
        no_pending()
        (EVIDENCE/'database-at-switch.dump').write_bytes(run('docker','exec',CONTAINER,'pg_dump','-U','dreamcore_migration_check','-d','dreamcore_trial','-Fc'))
        # Original unquoted env is preserved byte-for-byte; new values are appended as safe values.
        engine_token_line=next(line for line in (LIVE/'engine.env').read_text().splitlines() if line.startswith('TASK_ENGINE_TOKEN='))
        new_text=(EVIDENCE/'api-before.env').read_text().rstrip()+'\n'
        assert '?' not in values['DATABASE_URL']
        new_text=new_text.replace('DATABASE_URL='+values['DATABASE_URL']+'\n', 'DATABASE_URL='+values['DATABASE_URL']+'?options=-c%20jit%3Doff\n')
        new_text+='TASK_ENABLED=true\nAGENT_TASK_MODE=live\nTASK_CONCURRENCY=2\n'+engine_token_line+'\n'
        (ROOT/'api.env').write_text(new_text);(ROOT/'api.env').chmod(0o600)
        shutil.copy2(STAGE/'workspace-api-0.1.0-SNAPSHOT.jar',ROOT/'release/api.jar')
        run('chown','root:dreamcore',str(ROOT/'release/api.jar'));run('chmod','640',str(ROOT/'release/api.jar'))
        run('systemctl','start',API_UNIT);health('http://127.0.0.1:18481/api/v1/auth/csrf')
        assert sql('SELECT max(version::int) FROM flyway_schema_history WHERE success')=='108'
        (EVIDENCE/'active.json').write_text(json.dumps({'active':True,'concurrency':2,'apiSha256':digest(ROOT/'release/api.jar'),'automaticWork':False}))
        print((EVIDENCE/'active.json').read_text())
    except Exception:
        rollback()
        raise

def rollback():
    # Config/artifact-only rollback; user data and new task records are retained.
    run('systemctl','stop',API_UNIT)
    shutil.copy2(EVIDENCE/'api-before.env',ROOT/'api.env')
    shutil.copy2(EVIDENCE/'api-before.jar',ROOT/'release/api.jar')
    run('chown','root:dreamcore',str(ROOT/'release/api.jar'));run('chmod','640',str(ROOT/'release/api.jar'))
    run('systemctl','start',API_UNIT);health('http://127.0.0.1:18481/api/v1/auth/csrf')
    run('systemctl','stop',ENGINE_UNIT)
    limits=EVIDENCE/'database-limits-before.json'
    # Keep the OOM mitigation on artifact rollback; reducing live DB memory needs separate review.
    if limits.exists():run('docker','update','--cpus',str(json.loads(limits.read_text())['NanoCpus']/1000000000),CONTAINER)
    print(json.dumps({'rolledBack':True,'databaseRestored':False}))

if __name__=='__main__':
    os.umask(0o077)
    assert os.getuid()==0
    try:
        {'prepare':prepare,'activate':activate,'rollback':rollback}[sys.argv[1]]()
    except Exception as e:
        # Never echo subprocess stderr, input model configuration, or provider response bodies.
        print(json.dumps({'failed':True,'errorType':type(e).__name__}),file=sys.stderr)
        sys.exit(1)

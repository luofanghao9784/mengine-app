"""Explicit manual transport; installed configurations remain disabled until separately enabled."""
import hashlib,json,re,subprocess,tempfile,resource
from pathlib import Path


def collect(config,batch):
    if config.get('enabled') is not True or config.get('automaticRefresh') is not False:
        raise PermissionError('REAL_COLLECTION_NOT_ENABLED')
    if batch not in config['batches']:raise ValueError('Unknown fixed batch')
    item=config['batches'][batch];path=item['remoteConfig']
    if not re.fullmatch(r'/var/lib/dreamcore/(governance-20261015/source|full-governance-20261015/p[1-5]-[1-3])-private.json',path):
        raise ValueError('Unapproved remote config')
    source=Path(__file__).with_name('full_collector.py').read_text()
    if hashlib.sha256(source.encode()).hexdigest()!=config['collectorSha256']:raise ValueError('Installed code changed')
    payload={'path':path,'tenant':config['sourceTenantId'],'tables':item['tables']}
    program="ns={'__name__':'installed_reader'}\nexec("+repr(source)+",ns)\nrequest="+repr(payload)+'''\nc=ns['private'](request['path'])
if c['tenantId']!=request['tenant']:raise ValueError('Source tenant mismatch')
if 'projectionFile' in c:
 approved={t['name']:set(t['columns']) for t in ns['private'](c['projectionFile'])['tables']}
else:
 import ast
 from pathlib import Path
 tree=ast.parse(Path(request['path']).with_name('governance_collector.py').read_text())
 approved=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='COLUMNS' for t in n.targets))
for t in request['tables']:
 if t['name'] not in approved or set(t['columns'])!=set(approved[t['name']]):raise ValueError('Projection differs from installed source')
result=ns['collect_config'](c,{'tenantId':c['tenantId'],'contractVersion':'1.0','tables':request['tables']})
print(ns['json'].dumps(result,ensure_ascii=False,separators=(',',':')))
'''
    cmd=['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=8','ubuntu@139.155.42.35','sudo -n -u dreamcore python3 -']
    def limit():resource.setrlimit(resource.RLIMIT_FSIZE,(64*1024*1024,64*1024*1024))
    with tempfile.TemporaryFile() as out,tempfile.TemporaryFile() as err:
        p=subprocess.run(cmd,input=program.encode(),stdout=out,stderr=err,timeout=120,preexec_fn=limit)
        if p.returncode or out.tell()>64*1024*1024:raise ValueError('Read failed; old snapshot must be retained')
        out.seek(0); result=json.load(out)
    if result.get('tenantId')!=config['sourceTenantId'] or set(result.get('rows',{}))!={t['name'] for t in item['tables']}:raise ValueError('Source contract mismatch')
    result['sourceTenantId']=result['tenantId'];result['tenantId']=config['tenantId']
    return result

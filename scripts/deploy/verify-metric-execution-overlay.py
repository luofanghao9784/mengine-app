import pathlib,hashlib,json,subprocess,zipfile,urllib.request,urllib.error,re,tarfile,datetime
E=pathlib.Path('/var/lib/dreamcore/deploy-evidence/governance-third-20261016');S=E/'stage';A=pathlib.Path('/var/lib/dreamcore/app-check-20261010');WEB=pathlib.Path('/var/www/dreamcore-app-check-20261010')
M=json.loads((S/'manifest.json').read_text());sha=lambda p:hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
PG=['docker','exec','dreamcore-app-check-20261010','psql','-U','dreamcore_migration_check','-d','dreamcore_trial','-At','-v','ON_ERROR_STOP=1','-c']
def q(sql):return subprocess.check_output(PG+[sql],text=True).strip()
def get(url):
 try:
  with urllib.request.urlopen(url,timeout=15) as r:return r.status,r.read()
 except urllib.error.HTTPError as e:return e.code,b''
report={'sourceCommit':M['sourceCommit'],'apiSha256':sha(A/'release/api.jar')}
assert report['apiSha256']==sha(E/'api-candidate.jar')
with zipfile.ZipFile(A/'release/api.jar') as jar:
 for name,digest in M['files'].items():
  if name.startswith('BOOT-INF/'):assert hashlib.sha256(jar.read(name)).hexdigest()==digest,name
report['classesAndMigrationMatch']=True
for name,digest in M['files'].items():
 if name.startswith('web/'):assert sha(WEB/name[4:])==digest,name
report['staticFilesMatch']=True
assert sha('/var/lib/dreamcore/model-live-20261011/engine/dist/runtime/dataset-comparison.js')==M['files']['engine/dataset-comparison.js']
report['engineModuleMatch']=True
report['databaseVersion']=q('SELECT max(version::int) FROM flyway_schema_history WHERE success AND version IS NOT NULL');assert report['databaseVersion']=='143'
assert q('SELECT count(*) FROM flyway_schema_history WHERE NOT success')=='0'
report['metricDefinitions']=int(q('SELECT count(*) FROM scene_metrics'))
report['publishedMetrics']=int(q('SELECT count(*) FROM scene_metrics WHERE published_version IS NOT NULL'))
report['automaticDraftRuns']=q("SELECT state,count(*) FROM scene_processing_runs WHERE operation='GENERATE_METRICS' GROUP BY state")
report['automaticSettings']=q("SELECT enabled,count(*),coalesce(error_code,'OK') FROM metric_generation_settings GROUP BY enabled,error_code")
report['governanceSources']=q("SELECT kind,count(*) FROM scene_asset_links WHERE active GROUP BY kind ORDER BY kind")
report['policyLeasesCurrent']=q('SELECT count(*) FROM scene_bindings WHERE governance_valid_until>now()')
report['services']=subprocess.check_output(['systemctl','is-active','dreamcore-app-rehearsal','dreamcore-model-engine','dreamcore-wiki'],text=True).strip().splitlines();assert report['services']==['active']*3
report['health']={}
for url in ['http://127.0.0.1:18481/actuator/health','http://127.0.0.1:18482/healthz','http://127.0.0.1:18483/api/health','http://127.0.0.1:8086/actuator/health','https://ai.9pop.top/platform-admin/','https://ai.9pop.top/tenant-admin/','https://ai.9pop.top/workspace/','https://ai.9pop.top/tenant-admin/governance/?surface=tenant','https://coach.9pop.top','https://boss.9pop.top']:
 status,_=get(url);report['health'][url]=status;assert status==200,url
status,html=get('https://ai.9pop.top/tenant-admin/governance/?surface=platform');assert status==200
assets=re.findall(r'(?:src|href)="(/assets/[^"?]+)"',html.decode());assert assets
for path in assets:
 status,body=get('https://ai.9pop.top'+path);assert status==200 and hashlib.sha256(body).hexdigest()==sha(WEB/path.lstrip('/'))
report['publicAssetDigestsMatch']=len(assets)
route='https://ai.9pop.top/api/tenant-admin/v1/tenants/951228cb-58d8-474f-b784-55f5b946e81a/scene/metrics'
report['unauthenticatedMetricStatus']=get(route)[0];assert report['unauthenticatedMetricStatus'] in (401,403)
assert sha('/etc/nginx/sites-available/ai.9pop.top.conf')==sha(E/'nginx-before.conf')
with tarfile.open(E/'private-files-cutover.tar.gz') as archive:
 for name,path in [('api.env',A/'api.env'),('wiki-data/wiki.env',pathlib.Path('/var/lib/dreamcore/wiki-data/wiki.env'))]:
  assert hashlib.sha256(archive.extractfile(name).read()).hexdigest()==sha(path)
report['configurationPreserved']=True
for name,digest in json.loads((E/'backup-sha256.json').read_text()).items():assert sha(E/name)==digest,name
report['backupManifestVerified']=True
since=datetime.datetime.fromtimestamp((E/'database-cutover.dump').stat().st_mtime,datetime.timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
logs=subprocess.check_output(['journalctl','-u','dreamcore-app-rehearsal','-u','dreamcore-wiki','-u','dreamcore-model-engine','--since',since,'--no-pager'],text=True)
report['cutoverErrorLines']=sum(bool(re.search(r'\bERROR\b|SyntaxError|APPLICATION FAILED',line)) for line in logs.splitlines())
currentLogs=''
for service in ['dreamcore-app-rehearsal','dreamcore-wiki','dreamcore-model-engine']:
 invocation=subprocess.check_output(['systemctl','show',service,'-p','InvocationID','--value'],text=True).strip()
 currentLogs+=subprocess.check_output(['journalctl','_SYSTEMD_INVOCATION_ID='+invocation,'--no-pager'],text=True)
report['currentStartupErrorLines']=sum(bool(re.search(r'\bERROR\b|SyntaxError|APPLICATION FAILED',line)) for line in currentLogs.splitlines())
assert report['currentStartupErrorLines']==0,'Inspect restricted service logs before accepting release'
node="""
import {contextResponse} from '/var/lib/dreamcore/model-live-20261011/engine/dist/runtime/task-context.js';
const id='11111111-1111-4111-8111-111111111111';
const metric={items:[{metricId:id,version:1,definition:{name:'synthetic',aggregation:'COUNT'},authority:false}],hasMore:false,automaticExecution:false};
const source={datasetId:id,snapshotId:id,version:1,name:'synthetic',description:'synthetic',columns:['id'],totalColumns:1,columnOffset:0,nextColumnOffset:null,rowCount:1,coverageThrough:null,collectedAt:'2026-10-16T00:00:00Z',authority:false,governedMetrics:metric};
const response=contextResponse({contractVersion:'1.0',action:'dataset_search',referenceOnly:true,result:{items:[source],hasMore:false}},'dataset_search');
if(response.result.items[0].governedMetrics.items[0].version!==1)throw Error('Metric context lost');
"""
subprocess.run(['/opt/dreamcore/node-v24.20.0-linux-x64/bin/node','--input-type=module','-e',node],check=True)
report['liveEngineMetricContract']=True
(E/'final-verification.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))

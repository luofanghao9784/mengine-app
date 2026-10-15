import pathlib,json,hashlib,subprocess,urllib.request,zipfile,shlex,datetime
E=pathlib.Path('/var/lib/dreamcore/deploy-evidence/scene-queue-20261016');M=json.loads((E/'activated.json').read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
A=pathlib.Path('/var/lib/dreamcore/app-check-20261010/release/api.jar');W=pathlib.Path('/var/lib/dreamcore/wiki-20261015/dist/api/scene-knowledge.js')
assert sha(A)==M['actualApi'] and sha(W)==M['actualWiki']
with zipfile.ZipFile(A) as z:
 for n,h in M['files'].items():assert hashlib.sha256(z.read(n)).hexdigest()==h
with zipfile.ZipFile(A) as new,zipfile.ZipFile(E/'api.before.jar') as old:
 for n in old.namelist():
  if n not in M['files']:assert old.read(n)==new.read(n),n
report={'sourceCommit':M['sourceCommit'],'artifactDigestsMatch':True,'otherJarEntriesUnchanged':True,'model':'qwen3.7-plus','services':{}}
for unit,keys in [('dreamcore-model-engine',['AGENT_MODEL_NAME','AGENT_ROUTINE_MODEL_NAME']),('dreamcore-wiki',['DASHSCOPE_MODEL','DASHSCOPE_ROUTINE_MODEL'])]:
 pid=subprocess.check_output(['systemctl','show',unit,'-p','MainPID','--value'],text=True).strip()
 env=dict(s.split('=',1) for s in pathlib.Path('/proc/'+pid+'/environ').read_text().split('\0') if '=' in s)
 report['services'][unit]={k:env.get(k) for k in keys}
 assert all(env.get(k)=='qwen3.7-plus' for k in keys)
 before=dict((l.split('=',1)[0],l.split('=',1)[1]) for l in (E/(('engine.env' if 'engine' in unit else 'wiki.env')+'.before')).read_text().splitlines() if '=' in l and not l.startswith('#'))
 for k,v in before.items():
  if k not in keys:assert env.get(k)==shlex.split(v)[0],k
report['otherModelEnvironmentPreserved']=True
assert sha(pathlib.Path('/etc/nginx/sites-available/ai.9pop.top.conf'))==sha(E/'nginx.before.conf')
for n,h in json.loads((E/'backups.json').read_text()).items():assert sha(E/n)==h
report['backupsVerified']=True
report['health']={}
for url in ['http://127.0.0.1:18481/actuator/health','http://127.0.0.1:18482/healthz','http://127.0.0.1:18483/api/health','http://127.0.0.1:8086/actuator/health','https://ai.9pop.top/platform-admin/','https://ai.9pop.top/tenant-admin/','https://ai.9pop.top/workspace/','https://coach.9pop.top','https://boss.9pop.top']:
 with urllib.request.urlopen(url,timeout=15) as r:assert r.status==200;report['health'][url]=r.status
P=['docker','exec','dreamcore-app-check-20261010','psql','-U','dreamcore_migration_check','-d','dreamcore_trial','-At','-v','ON_ERROR_STOP=1','-c']
def q(s):return subprocess.check_output(P+[s],text=True).strip()
report['migrationVersion']=q('SELECT max(version::int) FROM flyway_schema_history WHERE success');assert report['migrationVersion']=='145'
report['failedMigrations']=q('SELECT count(*) FROM flyway_schema_history WHERE NOT success');assert report['failedMigrations']=='0'
report['recentQueueRuns']=q("SELECT operation,state,created_at,finished_at,round(extract(epoch from finished_at-created_at)) FROM scene_processing_runs WHERE operation IN ('SYNC_INPUTS','/scene-knowledge/sync') ORDER BY created_at DESC LIMIT 14")
report['latestModels']=q("SELECT model_name,count(*) FROM conversation_tasks WHERE created_at>now()-interval '10 minutes' GROUP BY model_name")
report['metricCounts']=q("SELECT count(*),count(published_version) FROM scene_metrics WHERE tenant_id='951228cb-58d8-474f-b784-55f5b946e81a'")
report['syncedAssets']=q("SELECT kind,count(*) FROM scene_asset_links WHERE active GROUP BY kind")
report['newErrorLines']={}
for unit in ['dreamcore-app-rehearsal','dreamcore-model-engine','dreamcore-wiki']:
 invocation=subprocess.check_output(['systemctl','show',unit,'-p','InvocationID','--value'],text=True).strip()
 logs=subprocess.check_output(['journalctl','_SYSTEMD_INVOCATION_ID='+invocation,'--no-pager'],text=True)
 report['newErrorLines'][unit]=sum(any(x in l for x in [' ERROR ','SyntaxError','APPLICATION FAILED']) for l in logs.splitlines())
 assert report['newErrorLines'][unit]==0,unit
report['verifiedAtUTC']=datetime.datetime.now(datetime.timezone.utc).isoformat()
(E/'verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False,indent=2))

"""Hash-pinned fixed metric plan runtime overlay. No database/config mutation."""
import pathlib,subprocess,hashlib,json,zipfile,shutil,os,time,sqlite3,urllib.request,sys
E=pathlib.Path('/var/lib/dreamcore/deploy-evidence/scene-queue-20261016');S=E/'stage'
A=pathlib.Path('/var/lib/dreamcore/app-check-20261010/release/api.jar')
W=pathlib.Path('/var/lib/dreamcore/wiki-20261015/dist/api/scene-knowledge.js')
N=pathlib.Path('/etc/nginx/sites-available/ai.9pop.top.conf')
ENVS=[pathlib.Path('/var/lib/dreamcore/model-live-20261011/engine.env'),pathlib.Path('/var/lib/dreamcore/wiki-data/wiki.env')]
PG=['docker','exec','dreamcore-app-check-20261010','psql','-U','dreamcore_migration_check','-d','dreamcore_trial','-At','-v','ON_ERROR_STOP=1','-c']
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def run(*a,**kw):return subprocess.run(a,check=True,**kw)
def q(s):return subprocess.check_output(PG+[s],text=True).strip()
def active():
 result={}
 for row in q("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND column_name IN('state','status') AND table_name IN('collection_runs','company_analysis_attempts','company_inference_runs','conversation_attempts','conversation_tasks','experience_analysis_runs','experience_generalization_runs','general_experience_adjustment_runs','knowledge_runs','ongoing_plan_runs','scene_processing_runs')").splitlines():
  t,c=row.split('|');n=int(q(f"SELECT count(*) FROM {t} WHERE {c} IN('QUEUED','RUNNING','CLAIMED','DISPATCHED','PENDING','PROCESSING')"))
  if n:result[t]=n
 with sqlite3.connect('file:/var/lib/dreamcore/wiki-data/mengine.db?mode=ro',uri=True) as db:
  for t,c,states in [('business_knowledge','state',"'running'"),('dictionary_jobs','state',"'queued','running','retry_wait'")]:
   n=db.execute(f'SELECT count(*) FROM {t} WHERE {c} IN({states})').fetchone()[0]
   if n:result[t]=n
 return result

def atomic(src,dst):
 tmp=dst.with_name(dst.name+'.queue-new');shutil.copy2(dst,tmp);tmp.write_bytes(src.read_bytes());os.replace(tmp,dst)
def health(url):
 for _ in range(80):
  try:
   with urllib.request.urlopen(url,timeout=2) as r:
    if r.status==200:return
  except Exception:pass
  time.sleep(1)
 raise RuntimeError('Health unavailable')
def start():
 for unit,url in [('dreamcore-wiki','http://127.0.0.1:18483/api/health'),('dreamcore-model-engine','http://127.0.0.1:18482/healthz'),('dreamcore-app-rehearsal','http://127.0.0.1:18481/actuator/health')]:run('systemctl','start',unit);health(url)

assert os.geteuid()==0
E=pathlib.Path('/var/lib/dreamcore/deploy-evidence/fixed-metric-plan-20261016');S=E/'stage'
R=pathlib.Path('/var/lib/dreamcore/model-live-20261011/engine/dist/runtime')
M=json.loads((S/'manifest.json').read_text());patch=json.loads((S/'patch.json').read_text())
for n,h in M['files'].items():assert sha(S/n)==h,n
for n,h in M['baseline'].items():assert sha(R/n)==h,n
assert not (E/'backups.json').exists(),'Already prepared'
assert not (R/'published-metric-plans.js').exists(),'Unexpected module'
backup={}
def replace(s,a,b):
 assert s.count(a)==1,a
 return s.replace(a,b)
for n in M['baseline']:
 shutil.copy2(R/n,E/(n+'.before'));backup[n]=sha(R/n)
 s=(R/n).read_text()
 if n=='agent-task.js':
  s="import { publishedMetricPlans } from './published-metric-plans.js';\n"+s
  s=replace(s,'const summaryCalculations = new Set();','const metricPlans = publishedMetricPlans();\n            const summaryCalculations = new Set();')
  s=replace(s,'datasetComparisonTool({','datasetComparisonTool({\n                            resolveMetricPlan: metricPlans.resolve,')
  s=replace(s,'contextTool(invoke, authorize, datasetContextAvailable, generalExperienceAvailable)','contextTool(invoke, authorize, datasetContextAvailable, generalExperienceAvailable, metricPlans.record)')
 elif n=='task-context.js':
  s=replace(s,'function contextTool(invoke, authorize, datasets = false, general = false)','function contextTool(invoke, authorize, datasets = false, general = false, onValidated)')
  s=replace(s,'            return result;','            onValidated?.(result);\n            return result;')
 else:
  a=s.index('        description: options.allowDateRange');b=s.index('        parameters:',a)
  s=s[:a]+patch['description']+s[b:]
  s=replace(s,'        async execute(args, signal) {','        async execute(args, signal) {\n            if (isRecord(args) && args.metricId !== undefined && options.resolveMetricPlan) {\n                await options.authorize();\n                args = normalizeDatasetArguments(options.resolveMetricPlan(args));\n            }')
 (E/(n+'.after.mjs')).write_text(s)
 run('/opt/dreamcore/node-v24.20.0-linux-x64/bin/node','--check',str(E/(n+'.after.mjs')))
shutil.copy2(N,E/'nginx.before.conf');(E/'backups.json').write_text(json.dumps(backup,indent=2))
original=N.read_text();assert original.count(' location /api/ {')==1
switched=False;stopped=False
try:
 N.write_text(original.replace(' location /api/ {',' location /api/ {\n  return 503;'));run('nginx','-t');run('systemctl','reload','nginx')
 for _ in range(90):
  pending=active()
  if not pending:break
  time.sleep(1)
 assert not pending,'Active work; no processes stopped '+str(pending)
 run('systemctl','stop','dreamcore-app-rehearsal');stopped=True
 assert not active(),'Work started before shutdown; no code switched'
 run('systemctl','stop','dreamcore-model-engine')
 for n,h in M['baseline'].items():assert sha(R/n)==h
 for n in M['baseline']:atomic(E/(n+'.after.mjs'),R/n)
 shutil.copyfile(S/'published-metric-plans.js',R/'published-metric-plans.js');os.chmod(R/'published-metric-plans.js',0o644)
 switched=True;start()
 M['actual']={n:sha(R/n) for n in [*M['baseline'],'published-metric-plans.js']}
 (E/'activated.json').write_text(json.dumps(M,indent=2));print(json.dumps({'sourceCommit':M['sourceCommit'],'actual':M['actual']}))
except Exception:
 if switched and not active():
  run('systemctl','stop','dreamcore-app-rehearsal');run('systemctl','stop','dreamcore-model-engine')
  for n in M['baseline']:atomic(E/(n+'.before'),R/n)
  (R/'published-metric-plans.js').unlink()
 if stopped:start()
 raise
finally:
 N.write_text(original);run('nginx','-t');run('systemctl','reload','nginx')

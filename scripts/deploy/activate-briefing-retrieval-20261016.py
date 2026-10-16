"""One-shot fixed-only briefing tool overlay. Preserve database, model config and cloud enhancements."""
import pathlib,subprocess,hashlib,json,zipfile,shutil,os,time,sqlite3,urllib.request,sys
N=pathlib.Path('/etc/nginx/sites-available/ai.9pop.top.conf')
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
E=pathlib.Path('/var/lib/dreamcore/deploy-evidence/briefing-live-test-20261016/retrieval-delivery');R=pathlib.Path('/var/lib/dreamcore/model-live-20261011/engine/dist/runtime')
E.mkdir(mode=0o700,exist_ok=True)
expected={'agent-task.js': '4fbe804f6b9eb062ba25abbbb7a905a7b7d23b766a9ed4fbc838b7aeda693b39', 'published-metric-plans.js': 'b27fe682e5d57155dbe580f6e2af5bd622acdff7f4bcabe2427fee066fec1c0f', 'briefing-delivery.js': '8f1400606322a9ebe25f2652a42d28c9b243a3448c87a3b18976b4390cd4cc40'}
for n,h in expected.items():
 assert sha(R/n)==h,n
 assert not (E/(n+'.before')).exists()
 shutil.copy2(R/n,E/(n+'.before'))
 s=(R/n).read_text()
 def change(a,b):
  global s
  assert s.count(a)==1,a
  s=s.replace(a,b)
 if n=='agent-task.js':
  change('const retrievalClosed = briefingGeneration && briefingDatasetLookups >= 3;', "const retrievalClosed = briefingGeneration && (briefingDatasetLookups >= 3 || ((!briefingRequestedType || briefingRequestedType === 'DATA') && metricPlans.hasPlans()));")
  change("(t.name !== 'task_context' || !briefingGeneration || briefingDatasetLookups < 3)","(t.name !== 'task_context' || !briefingGeneration || !retrievalClosed)")
  change('Dataset retrieval is closed after three successful lookups. Choose compare_dataset','Dataset retrieval is complete: a published executable plan is available or the lookup limit was reached. Choose compare_dataset')
 elif n=='published-metric-plans.js':
  change('    return {','    return {\n        hasPlans: () => plans.size > 0,')
 else:
  change('export const BRIEFING_EDITORIAL_HINTS = {',"export const BRIEFING_EDITORIAL_HINTS = {\n    BRIEFING_TEXT_INCOMPLETE: '标题为4–80字；摘要为12–240字；正文为2–4段、每段12–500字。摘要和每段正文均以句号、问号或叹号结束，不以括号或引号结束；保留有依据的内容，不补造事实。',\n    BRIEFING_ANALYSIS_REQUIRED: 'analysis 必须为2–4个完整段落组成的字符串数组，每段12–500字，不是单个字符串。',")
 (E/(n+'.after.mjs')).write_text(s)
 run('/opt/dreamcore/node-v24.20.0-linux-x64/bin/node','--check',str(E/(n+'.after.mjs')))
original=N.read_text();shutil.copy2(N,E/'nginx.before.conf');assert original.count(' location /api/ {')==1
stopped=False;switched=False
try:
 N.write_text(original.replace(' location /api/ {',' location /api/ {\n  return 503;'));run('nginx','-t');run('systemctl','reload','nginx')
 for _ in range(90):
  pending=active()
  if not pending:break
  time.sleep(1)
 assert not pending,str(pending)
 run('systemctl','stop','dreamcore-app-rehearsal');stopped=True
 assert not active(),'New active work; no switch'
 run('systemctl','stop','dreamcore-model-engine')
 for n,h in expected.items():assert sha(R/n)==h
 for n in expected:atomic(E/(n+'.after.mjs'),R/n)
 switched=True;start()
 (E/'fixed-only-activated.json').write_text(json.dumps({'before':expected,'after':{n:sha(R/n) for n in expected}},indent=2))
 print('FIXED_ONLY_ACTIVATED')
except Exception:
 if switched and not active():
  run('systemctl','stop','dreamcore-app-rehearsal');run('systemctl','stop','dreamcore-model-engine')
  for n in expected:atomic(E/(n+'.before'),R/n)
 if stopped:start()
 raise
finally:
 N.write_text(original);run('nginx','-t');run('systemctl','reload','nginx')

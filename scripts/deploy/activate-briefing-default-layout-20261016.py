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
E=pathlib.Path('/var/lib/dreamcore/deploy-evidence/briefing-live-test-20261016/default-layout');R=pathlib.Path('/var/lib/dreamcore/model-live-20261011/engine/dist/runtime')
E.mkdir(mode=0o700,exist_ok=True)
expected={'agent-task.js':'4b1292e4a7e45b78c5d0ca2baa01d0c8788ae4b75eab57466b14c9b871106630'}
for n,h in expected.items():
 assert sha(R/n)==h,n
 assert not (E/(n+'.before')).exists()
 shutil.copy2(R/n,E/(n+'.before'))
 s=(R/n).read_text()
 needle='presentationAvailable: briefingPresentationAvailable,';assert s.count(needle)==1
 s=s.replace(needle,'presentationAvailable: briefingPresentationAvailable && !briefingGeneration,')
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

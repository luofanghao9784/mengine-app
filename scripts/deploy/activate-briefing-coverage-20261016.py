"""Hash-pinned two-class API overlay. No migration and no data reset."""
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
E=pathlib.Path('/var/lib/dreamcore/deploy-evidence/briefing-bundle-20261016/coverage');S=E/'stage';A=pathlib.Path('/var/lib/dreamcore/app-check-20261010/release/api.jar')
M=json.loads((S/'manifest.json').read_text());assert sha(A)==M['baselineApi'];assert not (E/'api.before.jar').exists()
for n,h in M['files'].items():assert sha(S/n)==h,n
with zipfile.ZipFile(A) as z:
 for n,h in M['classesBefore'].items():assert hashlib.sha256(z.read(n)).hexdigest()==h,n
shutil.copy2(A,E/'api.before.jar')
with zipfile.ZipFile(A) as old,zipfile.ZipFile(E/'api.after.jar','w') as new:
 for info in old.infolist():new.writestr(info,(S/info.filename).read_bytes() if info.filename in M['classesBefore'] else old.read(info.filename))
with zipfile.ZipFile(E/'api.after.jar') as z:
 assert z.testzip() is None
 for n in M['classesBefore']:assert hashlib.sha256(z.read(n)).hexdigest()==M['files'][n]
original=N.read_text();assert original.count(' location /api/ {')==1;shutil.copy2(N,E/'nginx.before.conf');stopped=False;switched=False
try:
 N.write_text(original.replace(' location /api/ {',' location /api/ {\n  return 503;'));run('nginx','-t');run('systemctl','reload','nginx')
 for _ in range(55):
  pending=active()
  if not pending:break
  time.sleep(1)
 assert not pending,str(pending)
 run('systemctl','stop','dreamcore-app-rehearsal');stopped=True
 assert not active(),'New work; no version switch'
 run('systemctl','stop','dreamcore-model-engine')
 assert sha(A)==M['baselineApi'];atomic(E/'api.after.jar',A);switched=True;start()
 assert q('SELECT count(*) FROM flyway_schema_history WHERE NOT success')=='0'
 M['actualApi']=sha(A);M['databaseVersion']=q('SELECT max(version::int) FROM flyway_schema_history WHERE success');assert M['databaseVersion']=='145'
 M['backups']={'api.before.jar':sha(E/'api.before.jar'),'nginx.before.conf':sha(E/'nginx.before.conf')}
 (E/'activated.json').write_text(json.dumps(M,indent=2));print(json.dumps({'actualApi':M['actualApi'],'databaseVersion':M['databaseVersion']}))
except Exception:
 if switched:
  assert not active(),'Wait for active work before rollback; preserve new writes'
  run('systemctl','stop','dreamcore-app-rehearsal');run('systemctl','stop','dreamcore-model-engine');atomic(E/'api.before.jar',A)
 if stopped:start()
 raise
finally:
 N.write_text(original);run('nginx','-t');run('systemctl','reload','nginx')

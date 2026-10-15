"""One-time business-knowledge numeric-policy change; scoped failed work is requeued."""
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
E=pathlib.Path('/var/lib/dreamcore/deploy-evidence/knowledge-numeric-policy-20261016')
W=pathlib.Path('/var/lib/dreamcore/wiki-20261015/dist/api/business-knowledge.js')
BASE='1a7b5bc9f1994f6433a846315e57b0629cc358b8ac3d95c51c0f9bc06ae7247c'
assert sha(W)==BASE
E.mkdir(mode=0o700);shutil.copy2(W,E/'business.before.js');shutil.copy2(N,E/'nginx.before.conf')
s=W.read_text();assert s.count('                const normalizeNumber')==1
begin=s.index('                const normalizeNumber');end=s.index('                return [',begin)
removed=s[begin:end];assert '业务知识包含未经核验的数字' in removed and 'save(' not in removed
s=s[:begin]+'                // Numeric literal matching disabled; evidence references remain required.\n'+s[end:]
(E/'business.after.mjs').write_text(s);run('/opt/dreamcore/node-v24.20.0-linux-x64/bin/node','--check',str(E/'business.after.mjs'))
original=N.read_text();assert original.count(' location /api/ {')==1
switched=False;stopped=False
try:
 N.write_text(original.replace(' location /api/ {',' location /api/ {\n  return 503;'));run('nginx','-t');run('systemctl','reload','nginx')
 for _ in range(90):
  pending=active()
  if not pending:break
  time.sleep(1)
 assert not pending,'Active work; no service stopped: '+str(pending)
 run('systemctl','stop','dreamcore-app-rehearsal');stopped=True
 assert not active(),'Work started before shutdown; no code switched'
 run('systemctl','stop','dreamcore-wiki')
 DB='/var/lib/dreamcore/wiki-data/mengine.db'
 with sqlite3.connect('file:'+DB+'?mode=ro',uri=True) as src,sqlite3.connect(E/'wiki-before.db') as dest:src.backup(dest);assert dest.execute('pragma integrity_check').fetchone()[0]=='ok'
 assert sha(W)==BASE
 atomic(E/'business.after.mjs',W);switched=True
 with sqlite3.connect(DB) as db:
  tenant='951228cb-58d8-474f-b784-55f5b946e81a';reason='业务知识包含未经核验的数字'
  rows=db.execute("SELECT dataset_id,fingerprint,data FROM business_knowledge WHERE tenant_id=? AND state='failed' AND json_extract(data,'$.error')=?",(tenant,reason)).fetchall()
  (E/'requeued-private.json').write_text(json.dumps(rows));os.chmod(E/'requeued-private.json',0o600)
  count=db.execute("UPDATE business_knowledge SET state='pending' WHERE tenant_id=? AND state='failed' AND json_extract(data,'$.error')=?",(tenant,reason)).rowcount
  assert count==len(rows)
 start()
 manifest={'sourceCommit':sys.argv[1],'file':str(W),'before':BASE,'after':sha(W),'requeued':count,'backupSha256':sha(E/'wiki-before.db'),'schemaChanged':False}
 (E/'manifest.json').write_text(json.dumps(manifest,indent=2));print(json.dumps(manifest))
except Exception:
 if switched and not active():
  run('systemctl','stop','dreamcore-app-rehearsal');run('systemctl','stop','dreamcore-wiki');atomic(E/'business.before.js',W)
 if stopped:start()
 raise
finally:
 N.write_text(original);run('nginx','-t');run('systemctl','reload','nginx')

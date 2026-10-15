"""One-time queue/model configuration release. No schema or business-data changes."""
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
M=json.loads((S/'manifest.json').read_text())
assert sha(A)==M['baselineApi'] and sha(W)==M['baselineWiki']
for n,h in M['files'].items():assert sha(S/n)==h
assert not (E/'api.before.jar').exists(),'Already prepared: inspect evidence instead of rerunning'
shutil.copy2(A,E/'api.before.jar');shutil.copy2(W,E/'wiki.before.js');shutil.copy2(N,E/'nginx.before.conf')
for p in ENVS:shutil.copy2(p,E/(p.name+'.before'))
with zipfile.ZipFile(A) as old,zipfile.ZipFile(E/'api.after.jar','w') as new:
 for info in old.infolist():new.writestr(info,(S/info.filename).read_bytes() if info.filename in M['files'] else old.read(info.filename))
 for n in M['files']:
  if n.startswith('BOOT-INF/') and n not in old.namelist():new.writestr(n,(S/n).read_bytes())
s=W.read_text()
changes=[('["来自业务数据", String(businessItems.length)],','["业务知识条目", String(businessItems.length)],\n                    ["待整理数据集", String(structured.pending.length)],\n                    ["待学习资料", String(snap.pending)],'),('"正在分析业务数据"','"数据快照已接入，正在整理业务知识"'),('`${structured.pending.length} 个数据集待分析`','`数据快照已接入，${structured.pending.length} 个数据集待整理（不是逐条记录）`'),('`${structured.failed.length} 个数据集分析待重试`','`${structured.failed.length} 个数据集的知识整理失败，已接入快照保留`')]
for a,b in changes:assert s.count(a)==1,a;s=s.replace(a,b)
(E/'wiki.after.mjs').write_text(s);run('/opt/dreamcore/node-v24.20.0-linux-x64/bin/node','--check',str(E/'wiki.after.mjs'))
for p,keys in zip(ENVS,[['AGENT_MODEL_NAME','AGENT_ROUTINE_MODEL_NAME'],['DASHSCOPE_MODEL','DASHSCOPE_ROUTINE_MODEL']]):
 lines=p.read_text().splitlines()
 for k in keys:
  assert sum(l.startswith(k+'=') for l in lines)==1,k
  lines=[k+'="qwen3.7-plus"' if l.startswith(k+'=') else l for l in lines]
 target=E/(p.name+'.after');target.write_text('\n'.join(lines)+'\n');os.chmod(target,0o600)
original=N.read_text();assert original.count(' location /api/ {')==1
switched=False;stopped=False
try:
 N.write_text(original.replace(' location /api/ {',' location /api/ {\n  return 503;'));run('nginx','-t');run('systemctl','reload','nginx')
 for _ in range(60):
  pending=active()
  if not pending:break
  time.sleep(1)
 assert not pending,'Active work: no services stopped '+str(pending)
 run('systemctl','stop','dreamcore-app-rehearsal');stopped=True
 assert not active(),'Work detected after scheduler stop; restore service without switching'
 run('systemctl','stop','dreamcore-model-engine');run('systemctl','stop','dreamcore-wiki')
 with (E/'database-cutover.dump').open('wb') as f:run('docker','exec','dreamcore-app-check-20261010','pg_dump','-U','dreamcore_migration_check','-d','dreamcore_trial','-Fc',stdout=f)
 with (E/'database-cutover.dump').open('rb') as f:run('docker','exec','-i','dreamcore-app-check-20261010','pg_restore','--list',stdin=f,stdout=subprocess.DEVNULL)
 backups={p.name:sha(p) for p in E.iterdir() if p.is_file() and ('.before' in p.name or p.name=='database-cutover.dump')};(E/'backups.json').write_text(json.dumps(backups,indent=2))
 assert sha(A)==M['baselineApi'] and sha(W)==M['baselineWiki']
 atomic(E/'api.after.jar',A);atomic(E/'wiki.after.mjs',W)
 for p in ENVS:atomic(E/(p.name+'.after'),p)
 switched=True;start()
 M['actualApi']=sha(A);M['actualWiki']=sha(W);M['model']='qwen3.7-plus';M['databaseVersion']=q('SELECT max(version::int) FROM flyway_schema_history WHERE success');assert M['databaseVersion']=='145'
 (E/'activated.json').write_text(json.dumps(M,indent=2));print('ACTIVATED',M['actualApi'],M['actualWiki'])
except Exception:
 if switched:
  # Restore code/config only after drain; never restore DB over new writes.
  assert not active(),'Rollback requires active work to finish; preserve maintenance and inspect'
  for u in ['dreamcore-app-rehearsal','dreamcore-model-engine','dreamcore-wiki']:run('systemctl','stop',u)
  atomic(E/'api.before.jar',A);atomic(E/'wiki.before.js',W)
  for p in ENVS:atomic(E/(p.name+'.before'),p)
 if stopped:start()
 raise
finally:
 N.write_text(original);run('nginx','-t');run('systemctl','reload','nginx')

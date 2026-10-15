"""One-time engine-only patch; refuses changed baseline or active work. No DB writes."""
import pathlib,subprocess,hashlib,json,os,shutil,time,urllib.request,sys
E=pathlib.Path('/var/lib/dreamcore/deploy-evidence/governed-feedback-20261016')
F=pathlib.Path('/var/lib/dreamcore/model-live-20261011/engine/dist/runtime/agent-task.js')
N=pathlib.Path('/etc/nginx/sites-available/ai.9pop.top.conf')
NODE='/opt/dreamcore/node-v24.20.0-linux-x64/bin/node'
BASE='f7fb073d4471693aca3035e82ce9461269abaa91edaf9775370ea7aaf551cf46'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def run(*args):subprocess.run(args,check=True,stdout=subprocess.DEVNULL)
def active():
 sql="SELECT count(*) FROM conversation_tasks WHERE status IN ('QUEUED','RUNNING','CLAIMED','DISPATCHED','PENDING')"
 return int(subprocess.check_output(['docker','exec','dreamcore-app-check-20261010','psql','-U','dreamcore_migration_check','-d','dreamcore_trial','-At','-c',sql],text=True))
def health(url):
 for _ in range(60):
  try:
   with urllib.request.urlopen(url,timeout=2) as r:
    if r.status==200:return
  except Exception:pass
  time.sleep(1)
 raise RuntimeError('Health unavailable')
assert os.geteuid()==0 and sha(F)==BASE
assert not E.exists(),'One-time patch already prepared'
assert not active(),'Active business task: wait before patch'
E.mkdir(mode=0o700)
shutil.copy2(F,E/'agent-task.before.js');shutil.copy2(N,E/'nginx.before.conf')
s=F.read_text();anchor="                                'DATASET_PERIODS_MISSING',";assert s.count(anchor)==1
s=s.replace(anchor,anchor+"\n                                'METRIC_DEFINITION_REQUIRED',\n                                'METRIC_PLAN_MISMATCH',\n                                'DATASET_EMPTY',")
(E/'agent-task.after.mjs').write_text(s);run(NODE,'--check',str(E/'agent-task.after.mjs'))
original=N.read_text();assert original.count(' location /api/ {')==1
try:
 N.write_text(original.replace(' location /api/ {',' location /api/ {\n  return 503;'));run('nginx','-t');run('systemctl','reload','nginx')
 assert not active(),'Business task started before drain'
 run('systemctl','stop','dreamcore-app-rehearsal')
 assert not active(),'Task detected after scheduler stopped'
 run('systemctl','stop','dreamcore-model-engine')
 assert sha(F)==BASE
 temp=F.with_suffix('.new');shutil.copyfile(E/'agent-task.after.mjs',temp);os.chmod(temp,0o644);os.replace(temp,F)
 run('systemctl','start','dreamcore-model-engine');health('http://127.0.0.1:18482/healthz')
 run('systemctl','start','dreamcore-app-rehearsal');health('http://127.0.0.1:18481/actuator/health')
 (E/'manifest.json').write_text(json.dumps({'sourceCommit':sys.argv[1],'file':str(F),'before':BASE,'after':sha(F),'databaseChanged':False},indent=2))
 print('PATCH_VERIFIED',sha(F))
except Exception:
 # Restore code only; retain all writes and schema. Ensure any newly dispatched work drains first.
 if not active():
  run('systemctl','stop','dreamcore-app-rehearsal');run('systemctl','stop','dreamcore-model-engine')
  shutil.copy2(E/'agent-task.before.js',F)
 run('systemctl','start','dreamcore-model-engine');run('systemctl','start','dreamcore-app-rehearsal')
 raise
finally:
 N.write_text(original);run('nginx','-t');run('systemctl','reload','nginx')

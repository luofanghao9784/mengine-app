"""One-time, hash-pinned cloud release. Run prepare, then activate; rollback preserves data."""
import hashlib,json,os,pathlib,shlex,shutil,sqlite3,subprocess,sys,time,urllib.request,urllib.parse,zipfile
E=pathlib.Path('/var/lib/dreamcore/deploy-evidence/governance-second-20261016')
S=E/'stage';A=pathlib.Path('/var/lib/dreamcore/app-check-20261010')
W=pathlib.Path('/var/lib/dreamcore/wiki-20261015/dist/api');WEB=pathlib.Path('/var/www/dreamcore-app-check-20261010')
N=pathlib.Path('/etc/nginx/sites-available/ai.9pop.top.conf');NODE='/opt/dreamcore/node-v24.20.0-linux-x64/bin/node'
PG=['docker','exec','dreamcore-app-check-20261010','psql','-U','dreamcore_migration_check','-d','dreamcore_trial','-At','-v','ON_ERROR_STOP=1','-c']
bridge_url=next(shlex.split(line.split('=',1)[1])[0] for line in (A/'api.env').read_text().splitlines() if line.startswith('MENGINE_PLATFORM_BRIDGE_URL='))
bridge=urllib.parse.urlsplit(bridge_url)
assert bridge.hostname in ['127.0.0.1','localhost','::1'],'Unexpected Wiki endpoint'
WIKI_HEALTH=urllib.parse.urlunsplit((bridge.scheme,bridge.netloc,'/api/health','',''))
def run(*args,**kw):return subprocess.run(args,check=True,**kw)
def query(sql):return subprocess.check_output(PG+[sql],text=True).strip()
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def atomic(src,dest):
 dest=pathlib.Path(dest);dest.parent.mkdir(parents=True,exist_ok=True);tmp=dest.with_name(dest.name+'.governance-new');shutil.copyfile(src,tmp);os.chmod(tmp,0o644);os.replace(tmp,dest)
def backup_manifest():
 files={p.name:sha(p) for p in E.iterdir() if p.is_file() and p.name not in ['backup-sha256.json','final-verification.json']}
 (E/'backup-sha256.json').write_text(json.dumps(files,indent=2))
def health(url):
 for _ in range(40):
  try:
   with urllib.request.urlopen(url,timeout=3) as r:
    if r.status==200:return
  except Exception:pass
  time.sleep(1)
 raise RuntimeError('Health check failed: '+url)
def active():
 result={}
 rows=query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND column_name IN('state','status') AND table_name IN('collection_runs','company_analysis_attempts','company_inference_runs','conversation_attempts','conversation_tasks','experience_analysis_runs','experience_generalization_runs','general_experience_adjustment_runs','knowledge_runs','ongoing_plan_runs','scene_processing_runs')").splitlines()
 for row in rows:
  t,c=row.split('|');n=int(query(f"SELECT count(*) FROM {t} WHERE {c} IN('QUEUED','RUNNING','CLAIMED','DISPATCHED','PENDING','PROCESSING')"));
  if n:result[t]=n
 with sqlite3.connect('file:/var/lib/dreamcore/wiki-data/mengine.db?mode=ro',uri=True) as db:
  n=db.execute("SELECT count(*) FROM dictionary_jobs WHERE state IN('queued','running','retry_wait')").fetchone()[0]
  if n:result['dictionary_jobs']=n
 return result
def maintenance():
 assert (E/'nginx-before.conf').exists()
 original=(E/'nginx-before.conf').read_text();assert original.count(' location /api/ {')==1
 N.write_text(original.replace(' location /api/ {',' location /api/ {\n  return 503;'))
 run('nginx','-t');run('systemctl','reload','nginx')
def open_entry():atomic(E/'nginx-before.conf',N);run('nginx','-t');run('systemctl','reload','nginx')
def prepare():
 assert not (E/'api-before.jar').exists(),'Release already prepared'
 manifest=json.loads((S/'manifest.json').read_text())
 for name,value in manifest['files'].items():assert sha(S/name)==value,name
 assert sha(A/'release/api.jar')==manifest['baseApiSha256'],'Running API changed'
 for n,value in manifest['baseWikiSha256'].items():assert sha(W/n.replace('-live',''))==value,n
 assert query("SELECT max(version::int) FROM flyway_schema_history WHERE success AND version IS NOT NULL")=='141'
 assert query('SELECT count(*) FROM flyway_schema_history WHERE NOT success')=='0'

 shutil.copy2(A/'release/api.jar',E/'api-before.jar');shutil.copy2(N,E/'nginx-before.conf')

 for n in ['tenant-admin/governance/index.html']:
  shutil.copy2(WEB/n,E/(n.replace('/','-')+'.before'))
 migration='BOOT-INF/classes/db/cloud-migration/V142__scene_metric_catalog.sql'
 entries={str(p.relative_to(S)):p.read_bytes() for p in (S/'BOOT-INF').rglob('*') if p.is_file()}
 for output,overlay in [('api-candidate.jar',entries),('api-rollback.jar',{migration:entries[migration]})]:
  with zipfile.ZipFile(E/'api-before.jar') as old,zipfile.ZipFile(E/output,'w') as new:
   for info in old.infolist():new.writestr(info,overlay.get(info.filename,old.read(info.filename)))
   for name,body in overlay.items():
    if name not in old.namelist():new.writestr(name,body)
  with zipfile.ZipFile(E/output) as z:assert z.testzip() is None
 # Assets with the same fingerprint must have the same bytes.
 for p in (S/'web/assets').iterdir():
  target=WEB/'assets'/p.name
  if target.exists():assert sha(p)==sha(target),p.name
 print('PREPARED',sha(E/'api-candidate.jar'))
 backup_manifest()
def activate():
 manifest=json.loads((S/'manifest.json').read_text())
 for name,value in manifest['files'].items():assert sha(S/name)==value,name
 with zipfile.ZipFile(E/'api-candidate.jar') as candidate:
  for p in (S/'BOOT-INF').rglob('*'):
   if p.is_file():assert candidate.read(str(p.relative_to(S)))==p.read_bytes(),str(p)
 assert sha(A/'release/api.jar')==sha(E/'api-before.jar')
 maintenance()
 pending=active()
 for _ in range(30):
  if not pending:break
  time.sleep(1);pending=active()
 (E/'drain-before.json').write_text(json.dumps(pending))
 if pending:
  open_entry();raise RuntimeError('Tasks active; entry restored, no processes stopped')
 run('systemctl','stop','dreamcore-app-rehearsal.service')
 run('systemctl','stop','dreamcore-wiki.service')
 pending=active();(E/'drain-after.json').write_text(json.dumps(pending));assert not pending,'Investigate tasks before switching'
 assert sha(A/'release/api.jar')==sha(E/'api-before.jar'),'Concurrent API release detected'
 with (E/'database-cutover.dump').open('wb') as f:
  run('docker','exec','dreamcore-app-check-20261010','pg_dump','-U','dreamcore_migration_check','-d','dreamcore_trial','-Fc',stdout=f)
 with (E/'database-cutover.dump').open('rb') as f:run('docker','exec','-i','dreamcore-app-check-20261010','pg_restore','--list',stdin=f,stdout=subprocess.DEVNULL)
 run('tar','-czf',str(E/'private-files-cutover.tar.gz'),'-C',str(A),'objects','secrets','api.env','-C','/var/lib/dreamcore','wiki-data')
 run('tar','-tzf',str(E/'private-files-cutover.tar.gz'),stdout=subprocess.DEVNULL)
 with sqlite3.connect('file:/var/lib/dreamcore/wiki-data/mengine.db?mode=ro',uri=True) as src,sqlite3.connect(E/'wiki-cutover.db') as dest:
  src.backup(dest);assert dest.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
 src.close();dest.execute('PRAGMA wal_checkpoint(TRUNCATE)');dest.execute('PRAGMA journal_mode=DELETE');dest.close()  # Hash a standalone backup, not transient WAL files.
 for service in ['dreamcore-app-rehearsal','dreamcore-wiki','dreamcore-model-engine']:
  (E/(service+'.unit')).write_bytes(subprocess.check_output(['systemctl','cat',service]))
 backup_manifest()
 atomic(E/'api-candidate.jar',A/'release/api.jar')

 for p in (S/'web/assets').iterdir():atomic(p,WEB/'assets'/p.name)
 atomic(S/'web/tenant-admin/governance/index.html',WEB/'tenant-admin/governance/index.html')
 run('systemctl','start','dreamcore-wiki.service');health(WIKI_HEALTH)
 run('systemctl','start','dreamcore-app-rehearsal.service');health('http://127.0.0.1:18481/actuator/health')
 assert query("SELECT max(version::int) FROM flyway_schema_history WHERE success AND version IS NOT NULL")=='142'
 assert query('SELECT count(*) FROM flyway_schema_history WHERE NOT success')=='0'
 open_entry();print('ACTIVATED; verify first synchronization, authorization, HTTPS and peer services')
def rollback():
 maintenance();assert not active(),'Wait for active work before rollback'
 run('systemctl','stop','dreamcore-app-rehearsal.service');run('systemctl','stop','dreamcore-wiki.service');assert not active()
 with (E/'database-before-rollback.dump').open('wb') as f:run('docker','exec','dreamcore-app-check-20261010','pg_dump','-U','dreamcore_migration_check','-d','dreamcore_trial','-Fc',stdout=f)
 # Additive rollback retains V142, metric definitions, audit records and read gates.
 applied=query("SELECT count(*) FROM flyway_schema_history WHERE version='142' AND success")=='1'
 atomic(E/('api-rollback.jar' if applied else 'api-before.jar'),A/'release/api.jar')
 atomic(E/'tenant-admin-governance-index.html.before',WEB/'tenant-admin/governance/index.html')
 run('systemctl','start','dreamcore-wiki');health(WIKI_HEALTH)
 run('systemctl','start','dreamcore-app-rehearsal');health('http://127.0.0.1:18481/actuator/health');open_entry()
 print('ROLLED_BACK; database writes and metric gates retained')
assert os.geteuid()==0
E.mkdir(mode=0o700,parents=True,exist_ok=True);os.chmod(E,0o700)
{'prepare':prepare,'activate':activate,'rollback':rollback}[sys.argv[1]]()

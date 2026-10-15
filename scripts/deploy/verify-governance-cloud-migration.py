"""Run only against scripts/with-test-postgres.py's disposable database."""
import os, pathlib, subprocess, sys, urllib.parse
url=urllib.parse.urlparse(os.environ['DATABASE_URL'].removeprefix('jdbc:'))
assert url.hostname=='127.0.0.1' and url.path=='/dreamcore_test'
psql=str(pathlib.Path(os.environ['POSTGRES_BIN'])/'psql')
args=[psql,'-h',url.hostname,'-p',str(url.port),'-U',os.environ['DATABASE_USER'],'-d','dreamcore_test','-v','ON_ERROR_STOP=1']
env={**os.environ,'PGPASSWORD':os.environ['DATABASE_PASSWORD']}
files=sorted(pathlib.Path(sys.argv[1]).glob('V*.sql'),key=lambda p:int(p.name.split('__')[0][1:]))
for file in files+[pathlib.Path('apps/api/src/main/resources/db/migration/V127__scene_governance_gate.sql')]:
 subprocess.run(args+['-c',file.read_text()],env=env,check=True,stdout=subprocess.DEVNULL)
subprocess.run(args+['-c',"SELECT scene_asset_readable(gen_random_uuid(),gen_random_uuid()); SELECT library_mask(gen_random_uuid(),gen_random_uuid(),'MATERIAL',gen_random_uuid());"],env=env,check=True)
print('Cloud migration history through '+files[-1].name+' plus governance migration applied successfully.')

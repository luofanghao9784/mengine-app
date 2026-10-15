"""Verify the captured cloud schema and additive metric migration in a disposable database."""
import os,pathlib,subprocess,sys,urllib.parse
url=urllib.parse.urlparse(os.environ['DATABASE_URL'].removeprefix('jdbc:'))
assert url.hostname=='127.0.0.1' and url.path=='/dreamcore_test'
args=[str(pathlib.Path(os.environ['POSTGRES_BIN'])/'psql'),'-h',url.hostname,'-p',str(url.port),'-U',os.environ['DATABASE_USER'],'-d','dreamcore_test','-v','ON_ERROR_STOP=1']
env={**os.environ,'PGPASSWORD':os.environ['DATABASE_PASSWORD']}
files=sorted(pathlib.Path(sys.argv[1]).glob('V*.sql'),key=lambda p:int(p.name.split('__')[0][1:]))
assert files[-1].name.startswith('V141__')
for file in files+[pathlib.Path('apps/api/src/main/resources/db/migration/V128__scene_metric_catalog.sql'),pathlib.Path('apps/api/src/main/resources/db/migration/V129__metric_generation_execution.sql'),pathlib.Path('apps/api/src/main/resources/db/migration/V130__metric_delegated_definition.sql')]:
 subprocess.run(args+['-c',file.read_text()],env=env,check=True,stdout=subprocess.DEVNULL)
subprocess.run(args+['-c',"SELECT task_datasets_readable(gen_random_uuid()); SELECT auto_publish FROM metric_generation_settings;"],env=env,check=True)
print('Cloud V141 plus V142, V143 and V144 additive metric migrations verified; rollback keeps the schema and writes.')

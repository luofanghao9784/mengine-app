"""Hash-pinned reliability overlay; preserve the captured cloud application."""
import hashlib,json,pathlib,shutil,subprocess,sys
root=pathlib.Path(__file__).resolve().parents[2];stage=pathlib.Path(sys.argv[1]);stage.mkdir(parents=True,exist_ok=True)
assert not list(stage.iterdir()),'Use an empty release directory'
assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],cwd=root,text=True).strip(),'Commit owned source before packaging'
for package,names in [('scene',['MetricCatalog*.class','MetricDraftGenerator.class','MetricAutomaticDefinition*.class','GovernedDatasetCalculationService.class'])]:
 for pattern in names:
  for src in (root/'apps/api/target/classes/com/dreamcore/workspace'/package).glob(pattern):
   dest=stage/'BOOT-INF/classes/com/dreamcore/workspace'/package/src.name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dest)
p=stage/'BOOT-INF/classes/db/cloud-migration/V144__metric_delegated_definition.sql';p.parent.mkdir(parents=True,exist_ok=True)
shutil.copy2(root/'apps/api/src/main/resources/db/migration/V130__metric_delegated_definition.sql',p)
entry='tenant-admin/governance/index.html';(stage/'web'/entry).parent.mkdir(parents=True,exist_ok=True);shutil.copy2(root/'dist'/entry,stage/'web'/entry)
shutil.copytree(root/'dist/assets',stage/'web/assets',dirs_exist_ok=True)
(stage/'engine').mkdir(exist_ok=True)
for name in ['dataset-comparison.js','briefing-topic-strategy.js']:shutil.copy2(root/'engine/dist/runtime'/name,stage/'engine'/name)
(stage/'parser').mkdir(exist_ok=True)
for name in ['sandbox.py','linux_sandbox.py','linux_worker.py','structured_table.py']:shutil.copy2(root/'workers/parser'/name,stage/'parser'/name)
manifest={'sourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'baseline':json.loads((root/'.local/reliability/baseline.json').read_text()),'runtimeDependencies':{name:hashlib.sha256((root/'.local/reliability/tessdata'/name).read_bytes()).hexdigest() for name in ['eng.traineddata','chi_sim.traineddata']},'files':{}}
for p in sorted(stage.rglob('*')):
 if p.is_file() and p.name!='manifest.json':manifest['files'][str(p.relative_to(stage))]=hashlib.sha256(p.read_bytes()).hexdigest()
(stage/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print('Prepared reliability overlay:',len(manifest['files']),'files')

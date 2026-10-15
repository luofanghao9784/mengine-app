"""Hash-pinned third-batch overlay; preserve the captured cloud application."""
import hashlib,json,pathlib,shutil,subprocess,sys
root=pathlib.Path(__file__).resolve().parents[2];stage=pathlib.Path(sys.argv[1]);stage.mkdir(parents=True,exist_ok=True)
assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],cwd=root,text=True).strip(),'Commit owned source before packaging'
for package,names in [('scene',['MetricCatalog*.class','MetricController*.class','MetricPlan.class','MetricDraftGenerator.class','MetricGenerationWorker.class','GovernedDatasetCalculationService.class','GovernedBriefingContentService.class']),('conversation',['DatasetCalculationService$Request.class'])]:
 for pattern in names:
  for src in (root/'apps/api/target/classes/com/dreamcore/workspace'/package).glob(pattern):
   dest=stage/'BOOT-INF/classes/com/dreamcore/workspace'/package/src.name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dest)
p=stage/'BOOT-INF/classes/db/cloud-migration/V143__metric_generation_execution.sql';p.parent.mkdir(parents=True,exist_ok=True)
shutil.copy2(root/'apps/api/src/main/resources/db/migration/V129__metric_generation_execution.sql',p)
entry='tenant-admin/governance/index.html';(stage/'web'/entry).parent.mkdir(parents=True,exist_ok=True);shutil.copy2(root/'dist'/entry,stage/'web'/entry)
shutil.copytree(root/'dist/assets',stage/'web/assets',dirs_exist_ok=True)
(stage/'engine').mkdir(exist_ok=True);shutil.copy2(root/'engine/dist/runtime/dataset-comparison.js',stage/'engine/dataset-comparison.js')
manifest={'baseEngineSha256':'5454b1844e5b8bc1ca322e041d635fa9b1897c5597d49f85b31f28414eea467d','sourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'baseApiSha256':'e9b1e14e98173cd644714a30cc1d10d992b53c4bc4fef097677172d6da4de326','baseWikiSha256':{},'files':{}}
for p in sorted(stage.rglob('*')):
 if p.is_file() and p.name!='manifest.json':manifest['files'][str(p.relative_to(stage))]=hashlib.sha256(p.read_bytes()).hexdigest()
(stage/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print('Prepared metric catalog overlay:',len(manifest['files']),'files')

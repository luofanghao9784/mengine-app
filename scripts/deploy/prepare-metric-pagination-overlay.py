"""Hash-pinned metric pagination overlay; preserve the captured cloud application."""
import hashlib,json,pathlib,shutil,subprocess,sys
root=pathlib.Path(__file__).resolve().parents[2];stage=pathlib.Path(sys.argv[1]);stage.mkdir(parents=True,exist_ok=True)
assert not list(stage.iterdir()),'Use an empty release directory'
assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],cwd=root,text=True).strip(),'Commit owned source before packaging'
for package,names in [('scene',['MetricCatalog*.class','MetricController*.class','MetricDraftGenerator.class'])]:
 for pattern in names:
  for src in (root/'apps/api/target/classes/com/dreamcore/workspace'/package).glob(pattern):
   dest=stage/'BOOT-INF/classes/com/dreamcore/workspace'/package/src.name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dest)
p=stage/'BOOT-INF/classes/db/cloud-migration/V145__metric_generation_cursor.sql';p.parent.mkdir(parents=True,exist_ok=True)
shutil.copy2(root/'apps/api/src/main/resources/db/migration/V131__metric_generation_cursor.sql',p)
entry='tenant-admin/governance/index.html';(stage/'web'/entry).parent.mkdir(parents=True,exist_ok=True);shutil.copy2(root/'dist'/entry,stage/'web'/entry)
shutil.copytree(root/'dist/assets',stage/'web/assets',dirs_exist_ok=True)
manifest={'sourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'baseline':{'api':'fd8161a244bf31ccc37ccfda7b850d2ce74f8d676789e9f9ca53cf56ee12bcee'},'files':{}}
for p in sorted(stage.rglob('*')):
 if p.is_file() and p.name!='manifest.json':manifest['files'][str(p.relative_to(stage))]=hashlib.sha256(p.read_bytes()).hexdigest()
(stage/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print('Prepared metric pagination overlay:',len(manifest['files']),'files')

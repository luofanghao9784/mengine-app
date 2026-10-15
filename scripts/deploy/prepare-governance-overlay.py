"""Prepare the explicitly pinned cloud compatibility overlay; never replace unrelated modules."""
import hashlib,json,pathlib,re,shutil,subprocess,sys
root=pathlib.Path(__file__).resolve().parents[2]
baseline=pathlib.Path(sys.argv[1]);stage=pathlib.Path(sys.argv[2]);stage.mkdir(parents=True,exist_ok=True)
expected={'platform-bridge-live.js':'36bcd5b1608fd3778af7d0d917936db878f98e5336b6ef020d80d30df996bd67','scene-knowledge-live.js':'224f4576d53774e644bfb158c0bc5db7a880547770939d07fc66ce449d9bfaff'}
for name,sha in expected.items():assert hashlib.sha256((baseline/name).read_bytes()).hexdigest()==sha,name
def replace_once(s,a,b):
 assert s.count(a)==1,a
 return s.replace(a,b)
s=(baseline/'platform-bridge-live.js').read_text()
s="import {exportGovernance,governDerivedAssets} from './platform-governance.js';\nimport {dictionaryFingerprint} from './dictionary-version.js';\n"+s
s=replace_once(s,'updatedAt: d.updatedAt };','updatedAt: d.updatedAt, governance: exportGovernance(store,p.tenant,p.actor,u,d) };')
s=replace_once(s,'dictionaryStatus: set.dictionaryStatus, rows };',"dictionaryStatus: set.dictionaryStatus, dictionaryRevision: JSON.parse(store.db.prepare('SELECT data FROM data_dictionary WHERE dataset_id=? AND tenant_id=?').get(d.id,u.tenantId)?.data??'{}').revision??0, dictionaryFingerprint: dictionaryFingerprint(store,u.tenantId,set.definition), rows };")
s=replace_once(s,'const revision = digest(JSON.stringify(assets));','governDerivedAssets(assets);\n            const revision = digest(JSON.stringify(assets));')
s=replace_once(s,"contractVersion: '1.0', tenantId: p.tenant, revision, assets","contractVersion: '1.1', tenantId: p.tenant, revision, assets")
(stage/'wiki').mkdir(exist_ok=True);(stage/'wiki/platform-bridge.js').write_text(s)
s=(baseline/'scene-knowledge-live.js').read_text();s=replace_once(s,'id: k.id,','id: k.id,\n        sourceId: k.sourceId, sourceVersion: k.sourceVersion,')
(stage/'wiki/scene-knowledge.js').write_text(s)
shutil.copy2(root/'integrations/mengine-wiki/dist/api/platform-governance.js',stage/'wiki/platform-governance.js')
for name in ['SceneService','SceneGovernance']:
 p=pathlib.Path('BOOT-INF/classes/com/dreamcore/workspace/scene')/(name+'.class');(stage/p).parent.mkdir(parents=True,exist_ok=True)
 shutil.copy2(root/'apps/api/target/classes/com/dreamcore/workspace/scene'/p.name,stage/p)
p=stage/'BOOT-INF/classes/db/cloud-migration/V141__scene_governance_gate.sql';p.parent.mkdir(parents=True,exist_ok=True)
shutil.copy2(root/'apps/api/src/main/resources/db/migration/V127__scene_governance_gate.sql',p)
# Publish only the new entry and its complete fingerprinted dependency set.
web=stage/'web';entry='tenant-admin/governance/index.html';(web/entry).parent.mkdir(parents=True,exist_ok=True)
shutil.copy2(root/'dist'/entry,web/entry)
# Keeping old hashed assets is intentional. No existing application entry is replaced by a main build.
shutil.copytree(root/'dist/assets',web/'assets',dirs_exist_ok=True)
manifest={'sourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'baseApiSha256':'c7361bd8a680d0b32bad40069c581c350fcac35edc55c1e555fe5f0e31b2b495','baseWikiSha256':expected,'files':{}}
for p in sorted(stage.rglob('*')):
 if p.is_file() and p.name!='manifest.json':manifest['files'][str(p.relative_to(stage))]=hashlib.sha256(p.read_bytes()).hexdigest()
(stage/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Prepared pinned API overlay, three Wiki modules and governance page; files:',len(manifest['files']))

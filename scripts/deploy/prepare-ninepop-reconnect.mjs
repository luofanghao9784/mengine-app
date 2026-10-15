import {Store} from '/var/lib/dreamcore/wiki-20261015/dist/api/store.js';
import {registerConnections,connectionVault} from '/var/lib/dreamcore/wiki-20261015/dist/api/database-connections.js';
import {currentDictionary} from '/var/lib/dreamcore/wiki-20261015/dist/api/dictionary-version.js';
import {readFileSync,writeFileSync,chmodSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const tenant='951228cb-58d8-474f-b784-55f5b946e81a',root='/var/lib/dreamcore/deploy-evidence/ninepop-reconnect-20261016';
const store=new Store(root+'/staging/mengine.db');
const original=JSON.parse(readFileSync(process.env.DATABASE_DEPLOYED_SOURCES,'utf8'));
const vault=connectionVault(store);const used=new Set(store.db.prepare('SELECT data FROM database_connections WHERE tenant_id=?').all(tenant).map(r=>{const c=JSON.parse(r.data);return vault.open(tenant,c.secret).provider;}));
const selected=original.sources.filter(x=>x.tenantId===tenant&&used.has(x.id));if(selected.length!==used.size)throw Error('Missing registered source');
for(const [i,entry] of selected.entries()){
 const body=execFileSync('/usr/sbin/runuser',['-u','dreamcore','--',...entry.command],{timeout:90000,maxBuffer:100_000_000,env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'}});
 const parsed=JSON.parse(body);if(!parsed)throw Error('Invalid source snapshot');
 const path=root+'/source-'+i+'.json';writeFileSync(path,body,{mode:0o600});entry.command=['/usr/bin/cat',path];
}
writeFileSync(root+'/registry.json',JSON.stringify({sources:selected}),{mode:0o600});process.env.DATABASE_DEPLOYED_SOURCES=root+'/registry.json';
const docs=store.documents(tenant),sets=store.db.prepare('SELECT * FROM data_sets WHERE tenant_id=?').all(tenant),dicts=store.db.prepare('SELECT * FROM data_dictionary WHERE tenant_id=?').all(tenant),knowledge=store.db.prepare('SELECT * FROM deployment_knowledge WHERE tenant_id=?').all(tenant);
if(docs.length!==106||sets.length!==106||docs.some(d=>d.kind!=='数据表')||dicts.some(d=>JSON.parse(d.data).confirmed?.origin!=='deployment'))throw Error('Source inputs changed; inspect before reset');
const keep=new Set(['tenants','users','sessions','departments','database_connections','database_sync_jobs','platform_tenant_bindings','platform_actor_bindings','access_migrations','platform_bridge_nonces']);
const before={};store.db.pragma('foreign_keys=OFF');store.db.transaction(()=>{
 store.db.prepare('DELETE FROM conversation_turns WHERE conversation_id IN(SELECT id FROM conversations WHERE tenant_id=?)').run(tenant);store.db.prepare('DELETE FROM conversation_titles WHERE id IN(SELECT id FROM conversations WHERE tenant_id=?)').run(tenant);
 for(const {name} of store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()){
  if(keep.has(name))continue;
  if(!store.db.prepare(`PRAGMA table_info("${name}")`).all().some(c=>c.name==='tenant_id'))continue;
  before[name]=store.db.prepare(`DELETE FROM "${name}" WHERE tenant_id=?`).run(tenant).changes;
 }
 for(const d of docs){d.version=0;d.content='';d.summary='';d.status='ready';d.quality=100;d.issues=[];d.error=null;d.createdAt=new Date().toISOString();d.updatedAt=d.createdAt;store.db.prepare('INSERT INTO documents VALUES(?,?,?,?)').run(d.id,tenant,d.sha,JSON.stringify(d));}
 for(const s of sets){const data=JSON.parse(s.data);delete data.syncHash;store.db.prepare('INSERT INTO data_sets VALUES(?,?,?)').run(s.id,tenant,JSON.stringify(data));}
 for(const d of dicts){const data=JSON.parse(d.data);data.history=[];data.suggestion=null;store.db.prepare('INSERT INTO data_dictionary VALUES(?,?,?)').run(d.dataset_id,tenant,JSON.stringify(data));}
 for(const k of knowledge)store.db.prepare('INSERT INTO deployment_knowledge VALUES(?,?,?,?)').run(k.tenant_id,k.dataset_id,k.schema_fingerprint,k.data);
 for(const r of store.db.prepare('SELECT id,data FROM database_sync_jobs WHERE tenant_id=?').all(tenant)){const j=JSON.parse(r.data);if(!j.enabled)throw Error('Disabled source requires separate handling');j.state='idle';j.lastSuccess=null;j.lastAttempt=null;j.lastRows=0;j.unchanged=false;j.error='';j.nextAt=new Date(Date.now()+3600000).toISOString();store.db.prepare('UPDATE database_sync_jobs SET data=? WHERE id=?').run(JSON.stringify(j),r.id);}
})();store.db.pragma('foreign_keys=ON');
const routes=new Map(),app={get(){},patch(){},post(path,...args){routes.set(path,args.at(-1));}};
const stop=registerConnections(app,store,req=>{const u=store.user(req.actorId);if(!u?.active||u.tenantId!==tenant)throw Error('Actor unavailable');return u});await stop();
let imported=0,rows=0;
for(const r of store.db.prepare('SELECT data FROM database_sync_jobs WHERE tenant_id=? ORDER BY id').all(tenant)){
 const job=JSON.parse(r.data);const result=await routes.get('/api/database-sync/:id/run')({actorId:job.actorId,params:{id:job.id}});imported++;rows+=result.rows;
 if(imported%20===0)console.log(JSON.stringify({imported,rows}));
}
store.db.transaction(()=>{
 store.db.prepare('DELETE FROM doc_versions WHERE tenant_id=? AND version=0').run(tenant);store.db.prepare('DELETE FROM database_sync_history WHERE tenant_id=?').run(tenant);
 for(const r of store.db.prepare('SELECT * FROM deployment_knowledge WHERE tenant_id=?').all(tenant)){
  const doc=store.doc(tenant,r.dataset_id);const data=JSON.parse(r.data).map(k=>({...k,sourceVersion:doc.version}));store.db.prepare('UPDATE deployment_knowledge SET data=? WHERE tenant_id=? AND dataset_id=?').run(JSON.stringify(data),tenant,r.dataset_id);
 }
})();
let compatible=0;for(const r of store.db.prepare('SELECT dataset_id,data FROM data_dictionary WHERE tenant_id=?').all(tenant)){const def=JSON.parse(store.db.prepare('SELECT data FROM data_sets WHERE id=?').get(r.dataset_id).data);if(currentDictionary(store,tenant,def,JSON.parse(r.data).confirmed))compatible++;}
if(compatible!==106)throw Error('Source schema changed; preserve staged evidence and inspect');
if(store.db.pragma('foreign_key_check').length)throw Error('SQLite references invalid');
const report={imported,rows,compatibleDefinitions:compatible,cleared:before,currentVersions:store.db.prepare("SELECT count(*) n FROM documents WHERE tenant_id=? AND json_extract(data,'$.version')=1").get(tenant).n};
writeFileSync(root+'/staged-import.json',JSON.stringify(report,null,2),{mode:0o600});store.db.pragma('wal_checkpoint(TRUNCATE)');store.close();console.log(JSON.stringify({imported,rows,compatibleDefinitions:compatible}));

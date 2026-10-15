import { createHash, randomUUID } from 'node:crypto';
import type { Store } from './store.js';
import type { User, Doc } from './domain.js';
/** Additive, repeatable migration. Historical content is never rewritten. */
export function migrateAccess(store: Store) {
 const db=store.db;
 const columns=(db.prepare('PRAGMA table_info(departments)').all() as {name:string}[]).map(x=>x.name);
 if(!columns.includes('id'))db.exec('ALTER TABLE departments ADD COLUMN id TEXT');
 if(!columns.includes('active'))db.exec('ALTER TABLE departments ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
 db.exec('CREATE TABLE IF NOT EXISTS access_migrations(version TEXT PRIMARY KEY,at TEXT NOT NULL);');
 db.transaction(()=>{
  for(const d of db.prepare('SELECT tenant_id,name FROM departments WHERE id IS NULL').all() as {tenant_id:string;name:string}[])db.prepare('UPDATE departments SET id=? WHERE tenant_id=? AND name=?').run(randomUUID(),d.tenant_id,d.name);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS departments_stable_id ON departments(tenant_id,id)');
  if(!db.prepare("SELECT 1 FROM access_migrations WHERE version='2026-10-readonly-v1'").get()){
  for(const tenant of db.prepare('SELECT id FROM tenants').all() as {id:string}[]){
   let changes=0;
   const department=(name:string)=>(db.prepare('SELECT id FROM departments WHERE tenant_id=? AND (name=? OR id=?)').get(tenant.id,name,name) as {id:string}|undefined)?.id;
   for(const row of db.prepare('SELECT id,data FROM users WHERE tenant_id=?').all(tenant.id) as {id:string;data:string}[]){const u=JSON.parse(row.data) as User;u.departmentId=department(u.department);if(u.role==='admin')u.clearance=3;u.duties ||= {};db.prepare('UPDATE users SET data=? WHERE id=?').run(JSON.stringify(u),u.id);}
   for(const row of db.prepare('SELECT id,data FROM documents WHERE tenant_id=?').all(tenant.id) as {id:string;data:string}[]){const d=JSON.parse(row.data) as Doc;d.departmentId=department(d.department);const hadEdit=d.grants.some(g=>g.level==='edit');d.grants=d.grants.flatMap(g=>{const id=g.subjectType==='department'?department(g.subjectId):g.subjectId;return id?[{...g,subjectId:id,level:'read' as const}]:[]});if(hadEdit){d.policyVersion++;changes++;}db.prepare('UPDATE documents SET data=? WHERE id=?').run(JSON.stringify(d),d.id);}
   for(const p of store.proposals(tenant.id)){if(p.status==='pending'){p.status='invalidated';p.resolvedAt=new Date().toISOString();store.proposal(p);}}
   const actor=store.users(tenant.id).find(u=>u.role==='admin') || {id:'system:access-migration',tenantId:tenant.id,name:'权限迁移',email:'',department:'',role:'admin',clearance:3,active:true} as User;
   store.audit(actor,'policy.migrated',tenant.id,JSON.stringify({migration:'2026-10-readonly-v1',editGrantsConverted:changes,oldPending:'invalidated',duties:'no implicit grants'}));
  }
  db.prepare('INSERT INTO access_migrations VALUES(?,?)').run('2026-10-readonly-v1',new Date().toISOString());
  }
  if(!db.prepare("SELECT 1 FROM access_migrations WHERE version='2026-10-stable-department-fingerprint'").get()){
   const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
   for(const row of db.prepare('SELECT id,tenant_id,source_id,data FROM wiki_knowledge').all() as {id:string;tenant_id:string;source_id:string;data:string}[]){
    const d=store.doc(row.tenant_id,row.source_id);if(!d)continue;const old={...d};delete old.departmentId;const k=JSON.parse(row.data);
    // Only a representation-only change qualifies; changed content/policy hashes never match.
    if(k.fingerprint!==digest(d)&&k.fingerprint!==digest(old))continue;
    const canonical={...d,department:d.departmentId||d.department};delete canonical.departmentId;k.fingerprint=digest(canonical);db.prepare('UPDATE wiki_knowledge SET data=? WHERE id=? AND tenant_id=?').run(JSON.stringify(k),row.id,row.tenant_id);
   }
   db.prepare('INSERT INTO access_migrations VALUES(?,?)').run('2026-10-stable-department-fingerprint',new Date().toISOString());
  }
 })();
}

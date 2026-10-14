import {randomUUID} from 'node:crypto';
import type {Store} from './store.js';
const conflict=()=>Object.assign(Error('同步资源已被其他任务占用或执行凭据已过期，请重试'),{statusCode:409});
export function initializeSourceLeases(s:Store){
 s.db.exec('CREATE TABLE IF NOT EXISTS source_leases(tenant_id TEXT NOT NULL,resource TEXT NOT NULL,owner TEXT NOT NULL,expires INTEGER NOT NULL,PRIMARY KEY(tenant_id,resource))');
}
export function sourceBusy(s:Store,tenant:string,resource:string){
 return !!s.db.prepare('SELECT 1 FROM source_leases WHERE tenant_id=? AND resource=? AND expires>?').get(tenant,resource,Date.now());
}
// Bounded source reads finish within this lease. Expired workers must not publish;
// a replacement can take over after a crash without trusting process-local state.
export function acquireSourceLease(s:Store,tenant:string,resource:string){
 const owner=randomUUID(),at=Date.now();
 const claimed=s.db.prepare('INSERT INTO source_leases VALUES(?,?,?,?) ON CONFLICT(tenant_id,resource) DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE source_leases.expires<=?').run(tenant,resource,owner,at+120000,at);
 if(!claimed.changes)throw conflict();
 const valid=()=>!!s.db.prepare('SELECT 1 FROM source_leases WHERE tenant_id=? AND resource=? AND owner=? AND expires>?').get(tenant,resource,owner,Date.now());
 return {valid,assert:()=>{if(!valid())throw conflict();},release:()=>{s.db.prepare('DELETE FROM source_leases WHERE tenant_id=? AND resource=? AND owner=?').run(tenant,resource,owner);}};
}

import type {Store} from './store.js';
import {canUseAI, type Doc, type User} from './domain.js';

// This is an admission check, not a claim that a source is real-time.
// Source checks and content revisions are intentionally separate: unchanged syncs
// renew freshness without invalidating dictionaries or regenerating knowledge.
export function datasetAvailability(store:Store,tenant:string,id:string,at=Date.now()){
 const row=store.db.prepare('SELECT data FROM data_sets WHERE tenant_id=? AND id=?').get(tenant,id) as {data:string}|undefined;
 if(!row)return {allowed:false,mode:'unavailable',reason:'数据定义不存在'};
 const provenance=JSON.parse(row.data).provenance;
 if(!provenance?.connectionId)return {allowed:true,mode:'historical',reason:'历史导入，未验证源系统当前状态'};
 const raw=store.db.prepare('SELECT data FROM database_connections WHERE tenant_id=? AND id=?').get(tenant,provenance.connectionId) as {data:string}|undefined;
 const connection=raw?JSON.parse(raw.data):null;
 if(!connection||connection.disabled)return {allowed:false,mode:'blocked',reason:'来源连接不可用，保留历史数据'};
 if(!connection.fingerprint||connection.fingerprint!==provenance.sourceFingerprint)return {allowed:false,mode:'blocked',reason:'来源结构已变化，等待重新同步'};
 const jobs=(store.db.prepare('SELECT data FROM database_sync_jobs WHERE tenant_id=? ORDER BY id').all(tenant) as {data:string}[]).map(r=>JSON.parse(r.data)).filter(j=>j.datasetId===id);
 if(!jobs.length)return {allowed:true,mode:'historical',reason:'未配置持续同步，仅代表导入时的数据'};
 const enabled=jobs.filter(j=>j.enabled&&j.connectionId===provenance.connectionId&&j.table===provenance.table);
 if(!enabled.length)return {allowed:false,mode:'blocked',reason:'同步已停用或配置不匹配，保留历史数据'};
 const checks=enabled.map(j=>({lastVerifiedAt:j.lastSuccess as string,deadline:Date.parse(j.lastSuccess)+Number(j.intervalMinutes)*120000,interval:Number(j.intervalMinutes)}));
 const fresh=checks.filter(c=>Number.isFinite(c.deadline)&&c.interval>=5&&c.interval<=1440&&Date.parse(c.lastVerifiedAt)<=at&&c.deadline>at).sort((a,b)=>b.deadline-a.deadline)[0];
 if(!fresh)return {allowed:false,mode:'stale',reason:'超过两个同步周期未成功核对源库，等待同步恢复'};
 return {allowed:true,mode:'scheduled',reason:'在同步时效范围内，不代表源库实时状态',lastVerifiedAt:fresh.lastVerifiedAt,validUntil:new Date(fresh.deadline).toISOString()};
}
export function canUseCurrentData(store:Store,u:User,d:Doc){
 return canUseAI(u,d)&&(d.kind!=='数据表'||datasetAvailability(store,u.tenantId,d.id).allowed);
}

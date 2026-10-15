import type {Store} from './store.js';
import {now,type User} from './domain.js';
export function enqueueDictionary(store:Store,u:User,id:string){
 store.db.prepare("INSERT INTO dictionary_jobs(dataset_id,tenant_id,actor_id,state,updated_at,error) VALUES(?,?,?,'queued',?,'') ON CONFLICT(dataset_id) DO UPDATE SET actor_id=excluded.actor_id,state='queued',updated_at=excluded.updated_at,error='',attempts=0,next_at=''").run(id,u.tenantId,u.id,now());
 const d=store.doc(u.tenantId,id);if(d)store.recordFlow(d,'dictionary-queued');
}
export function startDictionaryWorker(store:Store,generate:(u:User,id:string,refresh:()=>User)=>Promise<unknown>,reconcile:()=>void=()=>{}){
 let stopping=false,active:Promise<void>|null=null,lastReconcile=0;
 store.db.prepare("UPDATE dictionary_jobs SET state='queued' WHERE state IN ('running','failed')").run();
 const tick=()=>{if(stopping||active)return;if(Date.now()-lastReconcile>=15_000){reconcile();lastReconcile=Date.now();}const job=store.db.prepare("SELECT * FROM dictionary_jobs WHERE state IN ('queued','retry_wait') AND next_at<=? ORDER BY next_at,updated_at LIMIT 1").get(now()) as {dataset_id:string;tenant_id:string;actor_id:string;updated_at:string;attempts:number}|undefined;if(!job)return;
 store.db.prepare("UPDATE dictionary_jobs SET state='running' WHERE dataset_id=?").run(job.dataset_id);
 active=(async()=>{try{const fresh=()=>{const u=store.user(job.actor_id);if(!u||!u.active||u.tenantId!==job.tenant_id)throw Error('任务发起账号已停用或不再属于本企业');return u;};await generate(fresh(),job.dataset_id,fresh);store.db.prepare("UPDATE dictionary_jobs SET state='succeeded',updated_at=?,error='',next_at='' WHERE dataset_id=? AND updated_at=?").run(now(),job.dataset_id,job.updated_at);}catch{
 const attempts=job.attempts+1;
 // Persistent exponential backoff, capped at 15 minutes; never exhaust attempts.
 const nextAt=new Date(Date.now()+Math.min(30_000*2**Math.min(attempts-1,5),900_000)).toISOString();
 const result=store.db.prepare("UPDATE dictionary_jobs SET state='retry_wait',updated_at=?,error=?,attempts=?,next_at=? WHERE dataset_id=? AND updated_at=?").run(now(),'本次自动生成未完成，系统将持续重试；请确认模型服务及任务账号权限可用',attempts,nextAt,job.dataset_id,job.updated_at);
 const d=store.doc(job.tenant_id,job.dataset_id);if(result.changes&&d)store.recordFlow(d,'dictionary-queued');
 }finally{active=null;}})();};
 const timer=setInterval(tick,1000);timer.unref();
 return async()=>{stopping=true;clearInterval(timer);await active;};
}

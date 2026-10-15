import {createHash} from 'node:crypto';
import type {SourceTable} from './database-source.js';
export const snapshotLimits={rows:100000,columns:100,bytes:64*1024*1024,cells:2000000};
const fail=()=>Object.assign(Error('部署来源完整性校验失败，保留上一版本'),{statusCode:502});
// v2 pages belong to one source transaction. Counts, keys and digests are checked
// before any document or record can be changed. v1 keeps its original limits.
export function validateSnapshot(result:any,tenant:string){
 const paged=result?.contractVersion==='2.0';
 if(!result||!['1.0','2.0'].includes(result.contractVersion)||result.tenantId!==tenant||!Array.isArray(result.tables)||!result.tables.length||result.tables.length>100||!result.rows||typeof result.rows!=='object'||Array.isArray(result.rows))throw fail();
 if(paged&&(!result.snapshot||result.snapshot.readOnly!==true||result.snapshot.isolation!=='REPEATABLE READ'||typeof result.snapshot.id!=='string'||!result.snapshot.id||typeof result.snapshot.readAt!=='string'||!result.proofs||typeof result.proofs!=='object'))throw fail();
 const limits=paged?snapshotLimits:{rows:10000,columns:30,bytes:20*1024*1024,cells:2000000};
 if(Buffer.byteLength(JSON.stringify(result))>limits.bytes)throw fail();
 const seen=new Set<string>();let cells=0;
 for(const t of result.tables as SourceTable[]){
  if(!t||t.access!==undefined&&t.access!=='owner-only'||typeof t.name!=='string'||!/^[_a-zA-Z0-9]{1,100}$/.test(t.name)||seen.has(t.name)||typeof t.comment!=='string'||!Array.isArray(t.columns)||!t.columns.length||t.columns.length>limits.columns)throw fail();seen.add(t.name);
  const names=new Set<string>();for(const c of t.columns){if(!c||typeof c.name!=='string'||names.has(c.name)||typeof c.type!=='string'||typeof c.nullable!=='boolean'||typeof c.primary!=='boolean'||typeof c.comment!=='string')throw fail();names.add(c.name);}
  const rows=result.rows[t.name];if(!Array.isArray(rows)||rows.length>limits.rows)throw fail();cells+=rows.length*names.size;if(cells>limits.cells)throw fail();
  for(const row of rows)if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).length!==names.size||Object.entries(row).some(([k,v])=>!names.has(k)||(v!==null&&typeof v!=='string')))throw fail();
  if(paged){
   const p=result.proofs[t.name],keys=t.columns.filter(c=>c.primary).map(c=>c.name);
   if(!p||p.snapshotId!==result.snapshot.id||!Number.isSafeInteger(p.expectedRows)||p.expectedRows!==rows.length||!Number.isInteger(p.pageSize)||p.pageSize<1||p.pageSize>5000||!Array.isArray(p.pageCounts)||p.pageCounts.length!==Math.ceil(rows.length/p.pageSize)||p.pageCounts.some((n:any,i:number)=>n!==Math.min(p.pageSize,rows.length-i*p.pageSize))||!keys.length||JSON.stringify(p.primaryKey)!==JSON.stringify(keys))throw fail();
   const ids=new Set<string>();for(const row of rows){if(keys.some(k=>row[k]===null||row[k]===''))throw fail();const id=JSON.stringify(keys.map(k=>row[k]));if(ids.has(id))throw fail();ids.add(id);}
   if(createHash('sha256').update(JSON.stringify(rows)).digest('hex')!==p.sha256)throw fail();
  }
 }
 if(Object.keys(result.rows).length!==seen.size||Object.keys(result.rows).some(k=>!seen.has(k))||paged&&(Object.keys(result.proofs).length!==seen.size||Object.keys(result.proofs).some(k=>!seen.has(k))))throw fail();
 return {scan:async()=>result.tables as SourceTable[],rows:async(t:SourceTable)=>{if(!seen.has(t.name))throw fail();return result.rows[t.name] as Record<string,unknown>[];},limits,receipt:(t:SourceTable)=>paged?{snapshot:result.snapshot,...result.proofs[t.name]}:null};
}

import {readFileSync,lstatSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {SourceTable} from './database-source.js';
const execute=promisify(execFile);
const fail=()=>Object.assign(Error('部署来源未登记、越权或读取失败'),{statusCode:502});
// Operator-owned registry. Neither a browser nor a model supplies commands, environment or SQL.
export async function deployedSource(provider:string,tenant:string){
 const file=process.env.DATABASE_DEPLOYED_SOURCES;
 if(!file||!isAbsolute(file))throw fail();
 const st=lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077)||![0,process.getuid?.()].includes(st.uid))throw fail();
 const registry=JSON.parse(readFileSync(file,'utf8'));const entry=registry.sources?.find((s:any)=>s.id===provider&&s.tenantId===tenant);
 if(!entry||!Array.isArray(entry.command)||!entry.command.length||entry.command.some((x:any)=>typeof x!=='string')||!isAbsolute(entry.command[0]))throw fail();
 let result:any;
 try{const {stdout}=await execute(entry.command[0],entry.command.slice(1),{timeout:60000,maxBuffer:20*1024*1024,env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'}});result=JSON.parse(stdout);}catch{throw fail();}
 if(result.contractVersion!=='1.0'||result.tenantId!==tenant||!Array.isArray(result.tables)||result.tables.length>100||!result.rows||typeof result.rows!=='object')throw fail();
 const seen=new Set<string>();
 for(const t of result.tables){if(!t||typeof t.name!=='string'||seen.has(t.name)||typeof t.comment!=='string'||!Array.isArray(t.columns)||!t.columns.length||t.columns.length>30)throw fail();seen.add(t.name);
  const names=new Set<string>();for(const c of t.columns){if(!c||typeof c.name!=='string'||names.has(c.name)||typeof c.type!=='string'||typeof c.nullable!=='boolean'||typeof c.primary!=='boolean'||typeof c.comment!=='string')throw fail();names.add(c.name);}
  const rows=result.rows[t.name];if(!Array.isArray(rows)||rows.length>10000)throw fail();
  for(const row of rows)if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).length!==names.size||Object.entries(row).some(([k,v])=>!names.has(k)||(v!==null&&typeof v!=='string')))throw fail();
 }
 return {scan:async()=>result.tables as SourceTable[],rows:async(t:SourceTable)=>{if(!seen.has(t.name))throw fail();return result.rows[t.name] as Record<string,unknown>[];}};
}

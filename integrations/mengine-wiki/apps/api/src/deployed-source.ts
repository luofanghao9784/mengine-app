import {validateSnapshot,snapshotLimits} from './source-snapshot.js';
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
 try{const {stdout}=await execute(entry.command[0],entry.command.slice(1),{timeout:90000,maxBuffer:snapshotLimits.bytes,env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'}});result=JSON.parse(stdout);}catch{throw fail();}
 return validateSnapshot(result,tenant);
}

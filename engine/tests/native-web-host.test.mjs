import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const listen=async server=>{server.listen(0,'127.0.0.1');await once(server,'listening');return server.address().port;};
test('reopening with a new grant preserves the running root; concurrent invalid grants cannot piggyback',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'native-host-test-'));
 const id='11111111-1111-4111-8111-111111111111';
 const platform=createServer((req,res)=>{if(!['Bearer first','Bearer second'].includes(req.headers.authorization)){res.writeHead(403).end();return;}res.setHeader('content-type','application/json');res.end(JSON.stringify({id}));});
 const upstream=createServer((req,res)=>{res.setHeader('set-cookie','owner=synthetic');res.end('native');});
 let child;
 try{
  const platformPort=await listen(platform),upstreamPort=await listen(upstream);
  const reserve=createServer();const hostPort=await listen(reserve);await new Promise(r=>reserve.close(r));
  await writeFile(join(dir,'docker'),`#!/usr/bin/env node\nconst fs=require('node:fs');const a=process.argv.slice(4);fs.appendFileSync(process.env.TEST_DOCKER_LOG,JSON.stringify(a)+'\\n');if(a[0]==='logs')console.log('token=synthetic');if(a[0]==='port')console.log('127.0.0.1:${upstreamPort}');process.stdin.resume();`,{mode:0o700});
  child=spawn(process.execPath,['scripts/native-web-host.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PATH:dir+':'+process.env.PATH,TEST_DOCKER_LOG:join(dir,'calls'),DREAMCORE_NATIVE_IMAGE:'sha256:'+'a'.repeat(64),DREAMCORE_NATIVE_PLATFORM_URL:`http://127.0.0.1:${platformPort}`,DREAMCORE_NATIVE_PUBLIC_URL:`http://127.0.0.1:${hostPort}`,DREAMCORE_NATIVE_APP_ORIGIN:'http://enterprise.test',DREAMCORE_NATIVE_SYNTHETIC:'true'},stdio:['ignore','pipe','pipe']});
  await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('host exited');}),new Promise((_,reject)=>setTimeout(()=>reject(Error('host timeout')),5000).unref())]);
  const launch=token=>fetch(`http://127.0.0.1:${hostPort}/launch`,{method:'POST',headers:{origin:'http://enterprise.test'},body:new URLSearchParams({id,token}),redirect:'manual'});
  const [first,invalid]=await Promise.all([launch('first'),launch('invalid')]);
  assert.equal(first.status,303);assert.equal(invalid.status,403);
  const second=await launch('second');assert.equal(second.status,303);
  assert.equal(second.headers.get('set-cookie'),first.headers.get('set-cookie'));
  const calls=(await readFile(join(dir,'calls'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(calls.filter(a=>a[0]==='run'&&a.includes('-d')).length,1);
  assert.equal(calls.filter(a=>a[0]==='rm').length,0);
 }finally{
  if(child&&child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}
  await Promise.all([new Promise(r=>platform.close(r)),new Promise(r=>upstream.close(r))]);
  await rm(dir,{recursive:true,force:true});
 }
});

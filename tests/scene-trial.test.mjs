import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createHmac, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
test('isolated scene restart preserves binding and never upgrades a new employee', async () => {
 const root=await mkdtemp(join(tmpdir(),'scene-trial-')); const key='synthetic-key-'.repeat(4);
 const tenant=randomUUID(),owner=randomUUID(),employee=randomUUID();
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
 await writeFile(join(root,'scene-private.json'),JSON.stringify({tenant,key}),{mode:0o600});
 await writeFile(join(root,'scene-binding.json'),JSON.stringify({tenant,owner,name:'合成企业',ownerName:'合成负责人'}),{mode:0o600});
 let child;
 async function stop(){if(child&&child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}}
 async function launch(){child=spawn(process.execPath,['scripts/local/scene-trial.mjs',root],{env:{PATH:process.env.PATH,API_PORT:String(port)},stdio:'ignore'});for(let i=0;i<100;i++){assert.equal(child.exitCode,null);try{if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok)return;}catch{}await delay(100);}throw Error('service not ready');}
 async function access(id){const payload=Buffer.from(JSON.stringify({tenant,actor:'customer:'+id,identity:{id,name:'合成用户'},path:'/scene-access',method:'GET',nonce:randomUUID(),at:Date.now()})).toString('base64url');const res=await fetch(`http://127.0.0.1:${port}/api/internal/platform-scene`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({payload,signature:createHmac('sha256',key).update(payload).digest('hex')})});assert.equal(res.status,200);return res.json();}
 try {await launch();const a=await access(owner),e=await access(employee);assert.equal(a.user.role,'admin');assert.equal(e.user.role,'member');assert.equal(e.user.clearance,0);assert.deepEqual(e.resources,[]);await stop();await launch();assert.equal((await access(owner)).user.id,a.user.id);assert.equal((await access(employee)).user.id,e.user.id);assert.equal((await access(employee)).user.role,'member');}
 finally{await stop();await rm(root,{recursive:true,force:true});}
});

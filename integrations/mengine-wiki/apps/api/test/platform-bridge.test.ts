import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../src/server.js';

test('signed platform bridge isolates sources, rejects replay and preserves data', async () => {
 const storage=await mkdtemp(join(tmpdir(),'platform-bridge-'));
 const prior=process.env.MENGINE_PLATFORM_BRIDGE_KEY;
 const secret='test-only-key-'.repeat(4);process.env.MENGINE_PLATFORM_BRIDGE_KEY=secret;
 const c=await buildServer({demo:true,storage});
 const envelope=(tenant:string,path:string,method='GET')=>{const payload=Buffer.from(JSON.stringify({tenant,path,method,actor:'central-operator',nonce:randomUUID(),at:Date.now()})).toString('base64url');return {payload,signature:createHmac('sha256',secret).update(payload).digest('hex')};};
 const call=(payload:ReturnType<typeof envelope>)=>c.app.inject({method:'POST',url:'/api/internal/platform-scene',payload});
 try{
  c.store.db.prepare('INSERT INTO platform_tenant_bindings VALUES(?,?,?)').run('enterprise-a','mengine-demo','u-admin');
  const before=c.store.db.prepare('SELECT count(*) n FROM data_rows').get();
  const signed=envelope('enterprise-a','/scene-foundation');
  const first=await call(signed);assert.equal(first.statusCode,200,first.body);assert.ok(first.json().items.length>0);
  assert.equal((await call(signed)).statusCode,409);
  assert.equal((await call({...envelope('enterprise-a','/scene-foundation'),signature:'0'.repeat(64)})).statusCode,401);
  assert.equal((await call(envelope('enterprise-b','/scene-foundation'))).statusCode,404);
  assert.equal((await call(envelope('enterprise-a','/auth/login','POST'))).statusCode,404);
  const exported=await call(envelope('enterprise-a','/scene-export'));assert.equal(exported.statusCode,200,exported.body);assert.equal(exported.json().tenantId,'enterprise-a');
  for(const asset of exported.json().assets)for(const field of asset.fields??[])assert.ok(!field.sensitive);
  assert.deepEqual(c.store.db.prepare('SELECT count(*) n FROM data_rows').get(),before);
  const customer=(path:string,identity=true)=>{const payload=Buffer.from(JSON.stringify({tenant:'enterprise-a',path,method:'GET',actor:'customer:new-member',...(identity?{identity:{id:'new-member',name:'企业新成员'}}:{}),nonce:randomUUID(),at:Date.now()})).toString('base64url');return {payload,signature:createHmac('sha256',secret).update(payload).digest('hex')};};
  assert.equal((await call(customer('/scene-access',false))).statusCode,403);
  const registered=await call(customer('/scene-access'));assert.equal(registered.statusCode,200,registered.body);
  assert.equal(registered.json().user.role,'member');assert.equal(registered.json().user.clearance,0);assert.notEqual(registered.json().user.id,'u-admin');assert.equal(registered.json().members.length,0);
  assert.equal((await call(customer('/scene-export'))).statusCode,404);
  const mapped=c.store.user(registered.json().user.id)!;mapped.active=false;c.store.saveUser(mapped);
  assert.equal((await call(customer('/scene-access'))).statusCode,404);
  assert.equal((c.store.db.prepare('SELECT count(*) n FROM sessions').get() as {n:number}).n,0);
 }finally{await c.app.close();await rm(storage,{recursive:true,force:true});if(prior===undefined)delete process.env.MENGINE_PLATFORM_BRIDGE_KEY;else process.env.MENGINE_PLATFORM_BRIDGE_KEY=prior;}
});

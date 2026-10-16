import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {seed} from '../src/seed.js';
import {indexFingerprint,WeKnoraRetrieval} from '../src/weknora-retrieval.js';
import type {Doc} from '../src/domain.js';
async function fixture(run:(c:any)=>Promise<void>) {
 const store=new Store(':memory:');seed(store);const u=store.user('u-admin')!;
 const d={...store.documents(u.tenantId)[0],id:'rag-test',tenantId:u.tenantId,ownerId:u.id,audience:'organization',status:'ready',aiPaused:false,version:1,policyVersion:1,title:'合成门店规则',content:'门店周报采用完成订单统计。联系手机号 13800138000。',sha:'rag-test'} as Doc;
 store.saveDoc(d);const calls:any[]=[];let handler:()=>Promise<any>=async()=>({success:true,data:[]});
 const rag=new WeKnoraRetrieval(store,{baseUrl:'http://127.0.0.1:19999',apiKey:'test-only',tenantLibraries:{[u.tenantId]:'kb-a'}},(async(_url:any,options:any)=>{
  calls.push({url:_url,body:options.body?JSON.parse(options.body):undefined});return new Response(JSON.stringify(await handler()));
 }) as typeof fetch);
 const bind=()=>store.db.prepare('INSERT OR REPLACE INTO weknora_bindings VALUES(?,?,?,?,?)').run(u.tenantId,d.id,indexFingerprint(d),'k-a','kb-a');
 try{await run({store,u,d,rag,calls,bind,setHandler:(h:any)=>{handler=h;}});}finally{store.close();}
}
test('search restricts IDs and validates citations',()=>fixture(async c=>{
 c.bind();c.setHandler(async()=>({success:true,data:[
 {knowledge_id:'foreign',knowledge_base_id:'kb-a',content:'泄漏',score:1},
 {knowledge_id:'k-a',knowledge_base_id:'kb-other',content:'门店周报',score:1},
 {knowledge_id:'k-a',knowledge_base_id:'kb-a',content:'伪造的文字',score:1},
 {knowledge_id:'k-a',knowledge_base_id:'kb-a',content:'门店周报采用完成订单统计。',score:.9}]}));
 const hits=await c.rag.search(c.u,[c.d],'完成订单');
 assert.deepEqual(c.calls[0].body.knowledge_ids,['k-a']);assert.equal(c.calls[0].body.knowledge_base_ids,undefined);
 assert.equal(hits.length,1);assert.ok(!hits[0].snippet.includes('13800138000'));assert.ok(!JSON.stringify(hits).includes('泄漏'));
}));
test('revocation during search excludes remote and fallback evidence',()=>fixture(async c=>{
 c.bind();c.setHandler(async()=>{c.store.saveDoc({...c.d,aiPaused:true});return {success:true,data:[{knowledge_id:'k-a',knowledge_base_id:'kb-a',content:'门店周报',score:1}]};});
 assert.deepEqual(await c.rag.search(c.u,[c.d],'门店周报'),[]);
}));
test('old versions are never sent to remote search',()=>fixture(async c=>{
 c.bind();c.store.saveDoc({...c.d,version:2,content:'新版本规则'});
 assert.equal((await c.rag.search(c.u,[c.d],'新版本'))[0].version,2);assert.equal(c.calls.length,0);
}));
test('outage falls back to authorized local retrieval',()=>fixture(async c=>{
 c.bind();c.setHandler(async()=>{throw new Error('unavailable');});
 assert.equal((await c.rag.search(c.u,[c.d],'门店周报')).length,1);
}));
test('index is masked scoped and repeatable',()=>fixture(async c=>{
 c.setHandler(async()=>({success:true,data:{id:'k-a'}}));await c.rag.index(c.u,c.d.id);await c.rag.index(c.u,c.d.id);
 assert.equal(c.calls.length,2);assert.equal(c.calls[1].body,undefined);assert.ok(c.calls[0].url.includes('/kb-a/'));assert.ok(!c.calls[0].body.content.includes('13800138000'));
}));
test('suspended user cannot search',()=>fixture(async c=>{
 c.bind();c.store.db.prepare('UPDATE users SET data=? WHERE id=?').run(JSON.stringify({...c.u,active:false}),c.u.id);
 assert.deepEqual(await c.rag.search(c.u,[c.d],'门店周报'),[]);assert.equal(c.calls.length,0);
}));

test('foreign tenant source is not exported or searched',()=>fixture(async c=>{
 c.bind();const foreign={...c.d,id:'foreign-doc',tenantId:'isolated-client',sha:'foreign'};c.store.saveDoc(foreign);
 assert.deepEqual(await c.rag.search(c.u,[foreign],'门店周报'),[]);
 await assert.rejects(c.rag.index(c.u,foreign.id));assert.equal(c.calls.length,0);
}));
test('disabled user cannot import using a stale session identity',()=>fixture(async c=>{
 c.store.db.prepare('UPDATE users SET data=? WHERE id=?').run(JSON.stringify({...c.u,active:false}),c.u.id);
 await assert.rejects(c.rag.index(c.u,c.d.id));assert.equal(c.calls.length,0);
}));
test('duplicate enterprise libraries are rejected',()=>fixture(async c=>{
 assert.throws(()=>new WeKnoraRetrieval(c.store,{baseUrl:'http://127.0.0.1',apiKey:'test',tenantLibraries:{a:'shared',b:'shared'}}));
}));
test('policy changes invalidate the external binding',()=>fixture(async c=>{
 c.bind();c.store.saveDoc({...c.d,policyVersion:2});
 await c.rag.search(c.u,[c.d],'门店周报');assert.equal(c.calls.length,0);
}));
test('submitted indexing is not reported as completed',()=>fixture(async c=>{
 c.setHandler(async()=>({success:true,data:{id:'k-a',parse_status:'processing'}}));
 assert.equal((await c.rag.index(c.u,c.d.id)).state,'submitted');
 assert.equal((await c.rag.index(c.u,c.d.id)).state,'submitted');
}));

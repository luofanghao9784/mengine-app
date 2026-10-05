import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { AgentTasks } from '../dist/runtime/agent-task.js';
import { PublicWebTask } from '../dist/runtime/public-web.js';
import { publicKeywords } from '../dist/runtime/public-search-mode.js';
import { listen, close, json } from './fixtures/agent.mjs';
import { usageFixture } from './fixtures/usage.mjs';
const source = { id:randomUUID(),url:'https://example.com/article',title:'公开资料',excerpt:'公开来源正文用于核验',kind:'SEARCH',sha256:'a'.repeat(64),retrievedAt:new Date().toISOString(),truncated:false };
test('automatic public keywords reject private identifiers and copied material before transport',()=>{
 for(const q of ['a@example.com','https://127.0.0.1/','password=abc','订单12345678'])assert.throws(()=>publicKeywords(q));
 assert.throws(()=>publicKeywords('曹鸿健 健身',[JSON.stringify({displayName:'9POP曹鸿健'})]));
 assert.throws(()=>publicKeywords('内部绝密经营数据',[JSON.stringify({content:'内部绝密经营数据属于内部资料'})]));
 assert.equal(publicKeywords('健身 会员服务 标准'),'健身 会员服务 标准');
});
test('automatic query searches are bounded and reads retain source handles',async()=>{
 const queries=[];const web=new PublicWebTask('web:optional:v1',{read:async()=>({...source,kind:'PAGE'})},{search:async q=>{queries.push(q);return [source]}});
 const signal=new AbortController().signal;
 await web.find(signal,'健身 服务');await web.find(signal,'健身 服务');await web.find(signal,'门店 运营');
 await assert.rejects(web.find(signal,'课程 管理'));assert.equal(queries.length,2);
 await assert.rejects(web.read('https://evil.example/',signal));assert.equal((await web.read(source.id,signal)).kind,'PAGE');
});
test('required mode cannot finish without both a successful search and an actual page read', async()=> {
 const { requirePublicEvidence } = await import('../dist/runtime/public-search-mode.js');
 requirePublicEvidence('AUTO',false,false);
 assert.throws(()=>requirePublicEvidence('REQUIRED',false,false),/PUBLIC_SEARCH_REQUIRED/);
 assert.throws(()=>requirePublicEvidence('REQUIRED',true,false),/PUBLIC_SEARCH_REQUIRED/);
 requirePublicEvidence('REQUIRED',true,true);
});

for (const mode of ['web:optional:v1', 'web:required:v1']) {
 test(`actual AgentTasks Harness registers ${mode} and completes its authorized flow`, async t => {
  let calls=0, searches=0, reads=0;
  const platform=createServer((req,res)=> {
   if(usageFixture(req,res)) return;
   if(req.url.endsWith('/check')) return json(res,{allowed:true,executionClass:'verification',publicQuery:mode});
   if(req.url.endsWith('/execution/open')) return json(res,{accepted:true,policy:'READ_ONLY_PRIVATE_V1'});
   if(req.url.endsWith('/execution/tool')) return json(res,{accepted:true});
   return json(res,{code:'unexpected'},404);
  });
  const url=await listen(platform); t.after(()=>close(platform));
  const required=mode==='web:required:v1';
  const agent=new AgentTasks({platformBaseUrl:url,executionClass:'verification',modelName:'synthetic-web-mode',
   publicWeb:{reader:{read:async()=>{reads++;return {...source,kind:'PAGE'}}},search:{search:async()=>{searches++;return [source]}}},
   createModel:()=>({async *generate(request) {
    calls++;
    const steps=[['activate_skill',{id:'public-research',version:'1.0.0'}],['public_search',{query:'健身 会员服务'}],['read_public_page',{id:source.id}]];
    if(required && calls<=steps.length) {
     const [name,args]=steps[calls-1];assert.ok(request.tools.some(t=>t.name===name));
     yield {type:'tool_call',id:'web-'+calls,name,arguments:JSON.stringify(args)};
     yield {type:'finish',reason:'tool_calls'};return;
    }
    yield {type:'text',text:required?'已核验合成公开来源。':'已有背景足够，本次无需联网。'};
    yield {type:'finish',reason:'stop'};
   }})});
  t.after(()=>agent.stop());
  const result=await agent.run({contractVersion:'1.5',taskId:randomUUID(),attemptId:randomUUID(),prompt:'合成业务背景分析'},new AbortController().signal);
  assert.equal(result.modelCalls,required?4:1);
  assert.equal(searches,required?1:0);assert.equal(reads,required?1:0);
  assert.ok(result.text.includes(required?'已核验':'无需联网'));
 });
}
test('keyword length remains enforced before transport with the compatible schema',()=>{
 assert.throws(()=>publicKeywords('x'.repeat(121)),/PUBLIC_QUERY_DENIED/);
});

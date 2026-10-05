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

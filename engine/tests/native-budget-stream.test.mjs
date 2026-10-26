import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LongTaskBudget} from '../dist/native/budget.js';
import {budgetedStream} from '../dist/native/budget-stream.js';
const scope={tenant:'t',user:'u',task:'root'};
const route={price:{version:'synthetic',input:1_000_000,output:1_000_000,cacheRead:1_000_000,cacheWrite:1_000_000,reasoningIncluded:true},maxInputTokens:1000,maxOutputTokens:100};
const request={provider:'synthetic',model:'fixture',messages:[],maxTokens:100};
const collect=async stream=>{const parts=[];for await(const part of stream)parts.push(part);return parts;};
test('full native blocks and usage pass through, including reasoning and auxiliary calls',async()=>{
 const ledger=new LongTaskBudget(':memory:');
 const chunks=[{type:'reasoning-delta',index:0,text:'fixture'},{type:'usage',usage:{inputTokens:20,outputTokens:15,reasoningTokens:5}},{type:'finish',reason:{kind:'stop'}}];
 for(const purpose of [undefined,'compaction','session-title']) {
   const result=await collect(budgetedStream({ledger,scope,route,request:{...request,purpose},dispatch:async function*(r){assert.equal(r.purpose,purpose);yield*chunks;}}));
   assert.deepEqual(result,chunks);
 }
 assert.equal(ledger.snapshot(scope).task,105);ledger.close();
});
test('unknown response and interrupted consumption retain reservation',async()=>{
 const ledger=new LongTaskBudget(':memory:');
 await assert.rejects(collect(budgetedStream({ledger,scope,route,request,dispatch:async function*(){throw Error('transport lost');}})));
 assert.equal(ledger.snapshot(scope).task,1100);
 for await(const chunk of budgetedStream({ledger,scope,route,request,dispatch:async function*(){yield {type:'text-delta',index:0,text:'partial'};}}))break;
 assert.equal(ledger.snapshot(scope).task,2200);ledger.close();
});
test('denied reservation or invalid pricing never calls the provider',async()=>{
 const ledger=new LongTaskBudget(':memory:');let called=false;
 await assert.rejects(collect(budgetedStream({ledger,scope,route:{...route,price:{...route.price,reasoningIncluded:false}},request,dispatch:async function*(){called=true;}})),{code:'MODEL_PRICE_UNVERIFIED'});
 assert.equal(called,false);ledger.close();
});
test('hard deadline reaches actual adapter signal and unknown usage stays reserved',async()=>{
 let now=1000;const ledger=new LongTaskBudget(':memory:',()=>now);
 ledger.reserve(scope,'start',1,1,route.price);ledger.settle(scope,'start',{inputTokens:0,outputTokens:0});
 now+=30*60000-20;let aborted=false;
 await assert.rejects(collect(budgetedStream({ledger,scope,route,request,dispatch:async function*(r){
   await new Promise((resolve,reject)=>r.signal.addEventListener('abort',()=>{aborted=true;reject(r.signal.reason);},{once:true}));
 }})),{code:'TASK_TIME_BUDGET'});
 assert.equal(aborted,true);assert.equal(ledger.snapshot(scope).task,1100);ledger.close();
});
test('prepared adapter generation and rich messages survive metering without mutation',async()=>{
 const {LlmAdapter,markAgentLoopRequest,isAgentLoopRequest}=await import('@deepseek-ai/dsh-llm');
 const {withBudget}=await import('../dist/native/budget-adapter.js');
 const ledger=new LongTaskBudget(':memory:');let generation=1;
 class Adapter extends LlmAdapter {
   #name='native-private';providerInfo(provider){return {id:provider,name:this.#name};}
   async prepareCall(){const saved=generation;return {model:{provider:'synthetic',id:'fixture',name:'fixture'},stream:async function*(r){
     assert.equal(saved,1);assert.equal(isAgentLoopRequest(r),true);assert.equal(Object.isFrozen(r),true);assert.equal(r.messages,messages);yield {type:'usage',usage:{inputTokens:2,outputTokens:1}};
   }};}
   async *stream(){throw Error('must use captured generation');}
 }
 const messages=Object.freeze([{role:'user',content:[{type:'image',attachment:{id:'synthetic'}}]}]);
 const adapter=withBudget(new Adapter(),{ledger,resolve:()=>({scope,route})});
 assert.equal(adapter.providerInfo('synthetic').name,'native-private');
 const prepared=await adapter.prepareCall('synthetic','fixture');generation=2;
 await collect(prepared.stream(markAgentLoopRequest(Object.freeze({...request,messages}))));
 assert.equal(ledger.snapshot(scope).task,3);ledger.close();
});
test('revoked authorization is checked before every retry dispatch and cannot reserve or call',async()=>{
 const {LlmAdapter}=await import('@deepseek-ai/dsh-llm');
 const {withBudget}=await import('../dist/native/budget-adapter.js');
 const ledger=new LongTaskBudget(':memory:');let authorized=true,called=0;
 class Adapter extends LlmAdapter{async *stream(){called++;yield {type:'usage',usage:{inputTokens:1,outputTokens:1}};}}
 const adapter=withBudget(new Adapter(),{ledger,resolve:async()=>{
  if(!authorized)throw Error('PERMISSION_REVOKED');return {scope,route};
 }});
 await collect(adapter.stream(request));authorized=false;
 await assert.rejects(collect(adapter.stream(request)),/PERMISSION_REVOKED/);
 assert.equal(called,1);assert.equal(ledger.snapshot(scope).task,2);ledger.close();
});

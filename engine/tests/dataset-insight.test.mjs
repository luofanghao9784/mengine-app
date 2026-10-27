import {test} from 'node:test';import assert from 'node:assert/strict';
import {datasetInsightContext,validateDatasetInsight,analyzeDatasetInsight} from '../dist/runtime/dataset-insight.js';
const c=datasetInsightContext({sources:['a','b'].map(datasetId=>({datasetId,snapshotId:'v1',releaseId:'r1',name:'合成表'})),facts:[{id:'F1',datasetId:'a',text:'甲表共 2 条记录'},{id:'F2',datasetId:'b',text:'乙表共 3 条记录'}],boundaries:'不能把跨表记录数相加当人数'});
const report={title:'先核对覆盖范围',findings:[{title:'两表粒度不同',interpretation:'可能需要先核对关联',action:'检查主键和来源范围',factIds:['F1','F2']}],limitations:'不推断利润或到账'};
test('business insight must cover every source and reject invented evidence',()=>{assert.deepEqual(validateDatasetInsight(report,c),report);for(const ids of [['F1'],['F1','F99']])assert.throws(()=>validateDatasetInsight({...report,findings:[{...report.findings[0],factIds:ids}]},c),/INVALID_DATASET_INSIGHT/);});
test('business insight uses one model call and no executable tools',async()=>{let calls=0;const model={async *generate(r){calls++;assert.deepEqual(r.tools,[]);assert.ok(JSON.stringify(r.messages).includes('甲表共 2 条记录'));yield {type:'text',text:JSON.stringify(report)};yield {type:'finish',reason:'stop'};}};await analyzeDatasetInsight(c,model,new AbortController().signal);assert.equal(calls,1);});

import {createServer} from 'node:http';import {listen,close,json,body} from './fixtures/agent.mjs';import {AgentTasks} from '../dist/runtime/agent-task.js';
test('business insight meters and reauthorizes before accepting model output',async()=>{
 for(const revoke of [false,true]){let generated=false;const actions=[];const platform=createServer(async(req,res)=>{const action=req.url.split('/').slice(5).join('/');await body(req);actions.push(action);if(action==='check')return generated&&revoke?json(res,{},403):json(res,{allowed:true,executionClass:'verification',datasetInsight:c});if(action==='model-usage/open')return json(res,{contractVersion:'1.0',maxModelCalls:8,maxOutputTokens:2048});if(['execution/open','model-usage/start','model-usage/finish'].includes(action))return json(res,{accepted:true});return json(res,{},400);});const url=await listen(platform);const backend={lastUsage:null,usage:null,async *generate(request){assert.deepEqual(request.tools,[]);yield {type:'text',text:JSON.stringify(report)};this.lastUsage={inputTokens:20,outputTokens:10};this.usage=this.lastUsage;generated=true;yield {type:'finish',reason:'stop'};}};const tasks=new AgentTasks({platformBaseUrl:url,executionClass:'verification',modelName:'fixture',createModel:()=>backend});
 try{const req={contractVersion:'1.5',taskId:'00000000-0000-4000-8000-000000000011',attemptId:'00000000-0000-4000-8000-000000000012',prompt:'synthetic'};if(revoke)await assert.rejects(()=>tasks.run(req,new AbortController().signal),/TASK_ACCESS_DENIED/);else assert.equal((await tasks.run(req,new AbortController().signal)).outcome,'COMPLETE');assert.ok(actions.includes('model-usage/finish'));assert.ok(actions.every(a=>['check','execution/open','model-usage/open','model-usage/start','model-usage/finish'].includes(a)));}finally{tasks.stop();await close(platform);}}
});

test('business insight accepts a full JSON fence without relaxing evidence validation',async()=>{
 let calls=0;const model={async *generate(){calls++;yield {type:'text',text:'```json\n'+JSON.stringify(report)+'\n```'};yield {type:'finish',reason:'stop'};}};
 const result=await analyzeDatasetInsight(c,model,new AbortController().signal);
 assert.deepEqual(JSON.parse(result.text),report);assert.equal(calls,1);
});
test('business insight repairs invalid JSON once and reports both model calls',async()=>{
 let calls=0;const model={async *generate(r){calls++;assert.deepEqual(r.tools,[]);yield {type:'text',text:calls===1?'invalid synthetic JSON':JSON.stringify(report)};yield {type:'finish',reason:'stop'};}};
 const result=await analyzeDatasetInsight(c,model,new AbortController().signal);
 assert.equal(calls,2);assert.equal(result.modelCalls,2);assert.deepEqual(JSON.parse(result.text),report);
});
test('business insight never accepts fabricated facts after correction and fails explicitly',async()=>{
 let calls=0;const bad={...report,findings:[{...report.findings[0],factIds:['invented']}]};
 const model={async *generate(){calls++;yield {type:'text',text:JSON.stringify(bad)};yield {type:'finish',reason:'stop'};}};
 await assert.rejects(()=>analyzeDatasetInsight(c,model,new AbortController().signal),/TASK_MODEL_FAILED/);assert.equal(calls,2);
});
test('business insight retries a fully returned truncated response once with a shorter JSON request',async()=>{
 let calls=0;const model={async *generate(r){calls++;assert.deepEqual(r.tools,[]);yield {type:'text',text:calls===1?'{"title":"synthetic truncated':JSON.stringify(report)};yield {type:'finish',reason:calls===1?'length':'stop'};}};
 const result=await analyzeDatasetInsight(c,model,new AbortController().signal);
 assert.equal(calls,2);assert.equal(result.modelCalls,2);assert.deepEqual(JSON.parse(result.text),report);
});
test('business insight does not replay transport or byte-limit failures',async()=>{
 const {RuntimeError}=await import('../dist/runtime/ports.js');
 for(const code of ['MODEL_NETWORK_ERROR','MODEL_OUTPUT_LIMIT']){
  let calls=0;const model={async *generate(){calls++;throw new RuntimeError(code);}};
  await assert.rejects(()=>analyzeDatasetInsight(c,model,new AbortController().signal),/TASK_MODEL_FAILED/);
  assert.equal(calls,1);
 }
});
test('business insight batches twelve sources within output and call budgets then validates global coverage',async()=>{
 const sources=Array.from({length:12},(_,i)=>({datasetId:'s'+i,snapshotId:'v1',releaseId:'r1',name:'合成表'}));
 const facts=sources.map((s,i)=>({id:'T'+i,datasetId:s.datasetId,text:'合成计算事实'}));
 const context=datasetInsightContext({sources,facts,boundaries:'合成边界'});
 let calls=0;const model={async *generate(r){
  const start=calls++*4;assert.deepEqual(r.tools,[]);
  if(calls===4){assert.match(JSON.stringify(r.messages),/candidates/);assert.match(JSON.stringify(r.messages),/T11/);}
  yield {type:'text',text:JSON.stringify({...report,findings:[{...report.findings[0],factIds:(calls===4?facts:facts.slice(start,start+4)).map(f=>f.id)}]})};yield {type:'finish',reason:'stop'};
 }};
 const result=await analyzeDatasetInsight(context,model,new AbortController().signal);
 assert.equal(calls,4);assert.equal(result.modelCalls,4);assert.equal(JSON.parse(result.text).findings.length,1);
 validateDatasetInsight(JSON.parse(result.text),context);
});
test('business insight preserves pre-dispatch cancellation without model calls',async()=>{
 let calls=0;const model={async *generate(){calls++;}};const controller=new AbortController();controller.abort();
 await assert.rejects(()=>analyzeDatasetInsight(c,model,controller.signal),/CANCELLED/);assert.equal(calls,0);
});

test('model cannot add factual prose even when its numbers occur in evidence',()=>{
 for(const observation of ['甲表利润 2 万元','甲表共 -2 条记录','两表共五条记录'])
  assert.throws(()=>validateDatasetInsight({...report,findings:[{...report.findings[0],observation}]},c),/INVALID_DATASET_INSIGHT/);
});

test('forty sources reserve final synthesis and corrections within eight calls',async()=>{
 const sources=Array.from({length:40},(_,i)=>({datasetId:'s'+i,snapshotId:'v',releaseId:'r',name:'合成表'}));
 const facts=sources.map((s,i)=>({id:'K'+i,datasetId:s.datasetId,text:'合成事实'}));
 const context=datasetInsightContext({sources,facts,boundaries:'不得跨表求和'});let calls=0;
 const model={async *generate(request){const step=Math.floor(calls++/2);if(calls%2){yield {type:'text',text:'invalid'};}else {const selected=step<3?facts.slice(step*14,step*14+14):facts;if(step===3){assert.match(JSON.stringify(request.messages),/candidates/);assert.match(JSON.stringify(request.messages),/K39/);}
 const findings=[];for(let i=0;i<selected.length;i+=20)findings.push({...report.findings[0],factIds:selected.slice(i,i+20).map(f=>f.id)});yield {type:'text',text:JSON.stringify({...report,findings})};}yield {type:'finish',reason:'stop'};}};
 const result=await analyzeDatasetInsight(context,model,new AbortController().signal);assert.equal(calls,8);assert.equal(result.modelCalls,8);validateDatasetInsight(JSON.parse(result.text),context);
});
test('failed synthesis never returns concatenated group reports',async()=>{
 const sources=Array.from({length:8},(_,i)=>({datasetId:'s'+i,snapshotId:'v',releaseId:'r',name:'合成表'})),facts=sources.map((s,i)=>({id:'K'+i,datasetId:s.datasetId,text:'合成事实'}));let calls=0;
 const model={async *generate(){const step=calls++;yield {type:'text',text:step<2?JSON.stringify({...report,findings:[{...report.findings[0],factIds:facts.slice(step*4,step*4+4).map(f=>f.id)}]}):'invalid'};yield {type:'finish',reason:'stop'};}};
 await assert.rejects(()=>analyzeDatasetInsight(datasetInsightContext({sources,facts,boundaries:'合成'}),model,new AbortController().signal),/TASK_MODEL_FAILED/);assert.equal(calls,4);
});

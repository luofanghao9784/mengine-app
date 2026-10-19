import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {AgentTasks} from '../dist/runtime/agent-task.js';
import {listen,close,body,json} from './fixtures/agent.mjs';
import {usageFixture} from './fixtures/usage.mjs';

for(const denied of [false,true])test(`platform authorization ${denied?'still fails closed on denial':'tolerates a bounded database lock wait'}`,async t=>{
 let checks=0,calls=0;
 const server=createServer(async(req,res)=>{
  if(usageFixture(req,res))return;
  await body(req);
  if(req.url.endsWith('/check')){
   if(denied)return json(res,{code:'TASK_ACCESS_DENIED'},403);
   if(++checks===1)await delay(3000);
   return json(res,{allowed:true,executionClass:'verification'});
  }
  if(req.url.endsWith('/execution/open'))return json(res,{accepted:true,policy:'READ_ONLY_PRIVATE_V1'});
  return json(res,{accepted:true});
 });
 const url=await listen(server);t.after(()=>close(server));
 const agent=new AgentTasks({platformBaseUrl:url,executionClass:'verification',modelName:'synthetic-latency',createModel:()=>({usage:null,async *generate(){calls++;yield {type:'text',text:'合成响应'};yield {type:'finish',reason:'stop'};}})});
 const run=()=>agent.run({contractVersion:'1.5',taskId:randomUUID(),attemptId:randomUUID(),prompt:'问候'},new AbortController().signal);
 if(denied){await assert.rejects(run(),{code:'TASK_ACCESS_DENIED'});assert.equal(calls,0);}
 else{const result=await run();assert.equal(result.outcome,'COMPLETE');assert.equal(calls,1);}
});

for (const recovers of [true,false]) test(`initial authorization transport ${recovers?'recovers once before any execution':'stays blocked after two failures'}`,async t=>{
 let checks=0,calls=0,opened=false;
 const server=createServer(async(req,res)=>{
  if(usageFixture(req,res))return;
  await body(req);
  if(req.url.endsWith('/check')){
   checks++;
   if(!recovers||checks===1)return json(res,{code:'INTERNAL_ERROR'},503);
   return json(res,{allowed:true,executionClass:'verification'});
  }
  if(req.url.endsWith('/execution/open')){assert.equal(checks,2);opened=true;return json(res,{accepted:true,policy:'READ_ONLY_PRIVATE_V1'});}
  return json(res,{accepted:true});
 });
 const url=await listen(server);t.after(()=>close(server));
 const agent=new AgentTasks({platformBaseUrl:url,executionClass:'verification',modelName:'synthetic-preflight',createModel:()=>({usage:null,async *generate(){assert.ok(opened);calls++;yield {type:'text',text:'合成核验响应'};yield {type:'finish',reason:'stop'};}})});
 const run=()=>agent.run({contractVersion:'1.5',taskId:randomUUID(),attemptId:randomUUID(),prompt:'问候'},new AbortController().signal);
 if(recovers){assert.equal((await run()).outcome,'COMPLETE');assert.equal(calls,1);}
 else{await assert.rejects(run(),{code:'TASK_ACCESS_DENIED'});assert.equal(checks,2);assert.equal(calls,0);assert.equal(opened,false);}
});

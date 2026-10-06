import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {createServer} from 'node:http';
import {AgentTasks} from '../dist/runtime/agent-task.js';import {listen,close,json} from './fixtures/agent.mjs';
test('engine admits twenty independent in-flight attempts and rejects overflow without executing models',async t=>{
 let release;const gate=new Promise(r=>release=r);let entered=0;
 const server=createServer(async(req,res)=>{entered++;await gate;json(res,{allowed:false});});const url=await listen(server);t.after(()=>close(server));
 const agent=new AgentTasks({platformBaseUrl:url,executionClass:'verification',modelName:'synthetic',createModel:()=>{throw Error('model must not execute');}});t.after(()=>agent.stop());
 const requests=Array.from({length:20},()=>({contractVersion:'1.4',taskId:randomUUID(),attemptId:randomUUID(),prompt:'synthetic concurrency'}));
 const running=requests.map(r=>agent.run(r,new AbortController().signal).then(()=>null,e=>e.code));
 try{await assert.rejects(agent.run({...requests[0],taskId:randomUUID(),attemptId:randomUUID()},new AbortController().signal),{code:'ENGINE_BUSY'});
 const until=Date.now()+3000;while(entered<20&&Date.now()<until)await new Promise(r=>setTimeout(r,10));assert.equal(entered,20);
 }finally{release();await Promise.all(running);}
 await agent.run({...requests[0],taskId:randomUUID(),attemptId:randomUUID()},new AbortController().signal).catch(e=>assert.notEqual(e.code,'ENGINE_BUSY'));
});

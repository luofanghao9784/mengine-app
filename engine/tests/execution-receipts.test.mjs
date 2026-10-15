import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {ExecutionReceipts} from '../dist/runtime/execution-receipts.js';
import {listen,close,body,json} from './fixtures/agent.mjs';
test('durable result replay survives runtime replacement, storage retries do not rerun work',async()=>{
 let saved,hash,claims=0,finishes=0,calls=0;
 const server=createServer(async(req,res)=>{assert.equal(req.headers.authorization,'Bearer '+ 't'.repeat(40));const value=await body(req);
  if(req.url.endsWith('/claim')){claims++;hash??=value.inputHash;assert.equal(value.inputHash,hash);return json(res,saved?{state:'COMPLETED',result:saved}:{state:claims===1?'NEW':'ACCEPTED'});}
  finishes++;saved=value.result;if(finishes===1)return json(res,{},503);return json(res,{accepted:true});
 });const url=await listen(server),id=randomUUID(),attempt=randomUUID();
 try{const execute=async()=>{calls++;return {answer:'synthetic'};};assert.deepEqual(await new ExecutionReceipts(url,'t'.repeat(40)).run('AGENT',id,attempt,{input:1},execute),{answer:'synthetic'});assert.deepEqual(await new ExecutionReceipts(url,'t'.repeat(40)).run('AGENT',id,attempt,{input:1},execute),{answer:'synthetic'});assert.equal(calls,1);assert.equal(finishes,2);}finally{await close(server);}
});
test('uncertain or unavailable receipt blocks model execution',async()=>{
 let status=200;const server=createServer(async(req,res)=>{await body(req);json(res,{state:'ACCEPTED'},status);});const url=await listen(server);let calls=0;
 try{const store=new ExecutionReceipts(url,'t'.repeat(40));for(const code of ['COMPANY_ATTEMPT_CONFLICT','EXECUTION_RECEIPT_UNAVAILABLE']){await assert.rejects(()=>store.run('COMPANY',randomUUID(),randomUUID(),{},async()=>{calls++;return {};}),{code});status=503;}assert.equal(calls,0);}finally{await close(server);}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { postJson } from '../dist/runtime/http-json.js';
import { listen, close, json } from './fixtures/agent.mjs';
test('calculation feedback retains only explicitly allowlisted error codes, never bodies or credentials',async t=>{
 let code='DATASET_COLUMNS_INVALID';
 const server=createServer((req,res)=>json(res,{code,message:'secret-business-row-and-token'},422));const url=await listen(server);t.after(()=>close(server));
 const call=()=>postJson(new URL('/calculate',url),'synthetic-only',{},new AbortController().signal,1024,1000,['DATASET_COLUMNS_INVALID']);
 await assert.rejects(call(),e=>e.code==='DATASET_COLUMNS_INVALID'&&!e.message.includes('secret'));
 code='RAW_PRIVATE_ERROR';await assert.rejects(call(),e=>e.code==='REMOTE_BAD_REQUEST'&&!e.message.includes('secret'));
});

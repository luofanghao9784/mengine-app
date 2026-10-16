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

// Exercise the actual agent transport allowlist, not a mock RuntimeError.
test('governed calculation failures survive the agent HTTP boundary with actionable safe hints', async t => {
 const {readFile}=await import('node:fs/promises');
 const {datasetComparisonTool}=await import('../dist/runtime/dataset-comparison.js');
 const source=await readFile(new URL('../dist/runtime/agent-task.js',import.meta.url),'utf8');
 const block=source.match(/\[\s*'INVALID_REQUEST',[\s\S]*?'DATASET_PERIODS_MISSING',[\s\S]*?\]/)?.[0];
 assert.ok(block,'agent calculation allowlist exists');
 const allowed=[...block.matchAll(/'([A-Z_]+)'/g)].map(m=>m[1]);
 let code='METRIC_DEFINITION_REQUIRED';
 const server=createServer((req,res)=>json(res,{code,message:'secret-business-row-and-token'},422));
 const url=await listen(server);t.after(()=>close(server));
 const tool=datasetComparisonTool({authorize:async()=>{},invoke:body=>postJson(new URL('/calculate',url),'synthetic-only',body,new AbortController().signal,1024,1000,allowed)});
 const request={datasetId:'00000000-0000-4000-8000-000000000001',snapshotId:'00000000-0000-4000-8000-000000000001',operation:'SUMMARY',aggregation:'COUNT',groupColumns:[]};
 for(code of ['METRIC_DEFINITION_REQUIRED','METRIC_PLAN_MISMATCH','DATASET_EMPTY']) {
  await assert.rejects(tool.execute(request,new AbortController().signal),e=>e.code===code&&!!e.hint&&!JSON.stringify(e).includes('secret'));
 }
 code='RAW_PRIVATE_ERROR';
 await assert.rejects(tool.execute(request,new AbortController().signal),e=>e.code==='REMOTE_BAD_REQUEST'&&!JSON.stringify(e).includes('secret'));
});

test('briefing text shape failures retain actionable codes without exposing response bodies',async t=>{
 const {BRIEFING_EDITORIAL_HINTS}=await import('../dist/runtime/briefing-delivery.js');
 let code='BRIEFING_TEXT_INCOMPLETE';
 const server=createServer((req,res)=>json(res,{code,message:'private-content'},422));
 const url=await listen(server);t.after(()=>close(server));
 for(code of ['BRIEFING_TEXT_INCOMPLETE','BRIEFING_ANALYSIS_REQUIRED']){
  assert.ok(BRIEFING_EDITORIAL_HINTS[code]);
  await assert.rejects(postJson(new URL('/deliver',url),'synthetic',{},new AbortController().signal,1024,1000,Object.keys(BRIEFING_EDITORIAL_HINTS)),e=>e.code===code&&!e.message.includes('private-content'));
 }
});

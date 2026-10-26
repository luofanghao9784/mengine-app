import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DelegatedModel} from '../dist/runtime/delegated-model.js';
import {learnWiki,wikiSource} from '../dist/runtime/wiki-learning.js';
const task='00000000-0000-4000-8000-000000000011', attempt='00000000-0000-4000-8000-000000000012';
const source=wikiSource({filename:'合成来源.txt',version:1,fragments:[{id:'00000000-0000-4000-8000-000000000001',locator:'第一段',content:'合成资料仅用于验证任务引用。'}]});
const article={title:'合成草稿',intro:'仅测试',content:'合成资料仅用于验证任务引用。',evidence:[{chunkId:source.fragments[0].id,quote:'合成资料仅用于验证任务引用'}]};
const response=(r,text=JSON.stringify(article))=>({version:'1.0',id:r.id,taskId:r.taskId,attemptId:r.attemptId,inputHash:r.inputHash,executor:'CODEX',text});
test('delegated response traverses existing Wiki Harness and quote validator; unknown usage stays null',async()=>{
 let request;
 const model=new DelegatedModel(task,attempt,{async request(r){request=r;return response(r)}});
 const result=await learnWiki(source,model,new AbortController().signal);
 assert.equal(request.taskId,task);assert.equal(request.attemptId,attempt);assert.match(JSON.stringify(request.messages),/合成资料/);
 assert.equal(result.modelCalls,1);assert.deepEqual(JSON.parse(result.text),article);assert.equal(model.usage,null);
});
test('wrong task, attempt, request or input hash and wrong executor cannot complete a model call',async()=>{
 for(const patch of [{taskId:attempt},{attemptId:task},{id:task},{inputHash:'wrong'},{executor:'OTHER'},{text:''}]){
  const model=new DelegatedModel(task,attempt,{async request(r){return {...response(r),...patch}}});
  await assert.rejects(async()=>{for await(const _ of model.generate({messages:[],tools:[],maxTokens:100,signal:new AbortController().signal})){}},/INVALID_MODEL_RESPONSE/);
 }
});
test('returned but fabricated content is rejected by the same application validator',async()=>{
 const model=new DelegatedModel(task,attempt,{async request(r){return response(r,JSON.stringify({...article,evidence:[{chunkId:source.fragments[0].id,quote:'此句不是原文不能作为依据'}]}))}});
 await assert.rejects(()=>learnWiki(source,model,new AbortController().signal),/INVALID_WIKI_RESULT/);
});
test('abort after response and executable tool requests fail closed',async()=>{
 const abort=new AbortController();const model=new DelegatedModel(task,attempt,{async request(r){abort.abort();return response(r)}});
 await assert.rejects(()=>learnWiki(source,model,abort.signal));
 const toolModel=new DelegatedModel(task,attempt,{request(){throw Error('must not dispatch')}});
 await assert.rejects(async()=>{for await(const _ of toolModel.generate({messages:[],tools:[{name:'write',description:'',parameters:{}}],maxTokens:100,signal:new AbortController().signal})){}},/INVALID_MODEL_INPUT/);
});

import {createServer} from 'node:http';
import {listen,close,json,body} from './fixtures/agent.mjs';
import {AgentTasks} from '../dist/runtime/agent-task.js';
test('task-scoped Codex adapter runs normal execution/metering/final authorization; no fabricated usage',async()=>{
 const actions=[];
 const platform=createServer(async(req,res)=>{
  const action=req.url.split('/').slice(5).join('/');const input=await body(req);actions.push({action,input});
  if(action==='check')return json(res,{allowed:true,executionClass:'verification',wikiLearning:source});
  if(action==='model-usage/open')return json(res,{contractVersion:'1.0',maxModelCalls:8,maxOutputTokens:2048});
  if(['execution/open','model-usage/start','model-usage/finish'].includes(action))return json(res,{accepted:true});
  return json(res,{code:'unexpected'},400);
 });
 const url=await listen(platform);let selected=0;
 const tasks=new AgentTasks({platformBaseUrl:url,executionClass:'verification',modelName:'fixture-standard',
  createModel(){throw Error('unselected model must not execute')},
  governanceModel(scope){selected++;assert.deepEqual(scope,{taskId:task,attemptId:attempt,workflow:'wikiLearning'});
   return {modelName:'codex-delegated',createModel:()=>new DelegatedModel(task,attempt,{async request(r){return response(r)}})};
  }});
 try{
  const result=await tasks.run({contractVersion:'1.5',taskId:task,attemptId:attempt,prompt:'合成测试'},new AbortController().signal);
  assert.equal(selected,1);assert.equal(result.modelName,'codex-delegated');assert.equal(result.usage,null);
  assert.equal(result.outcome,'COMPLETE');assert.equal(result.modelCalls,1);assert.deepEqual(JSON.parse(result.text),article);
  assert.deepEqual(actions.find(x=>x.action==='execution/open').input,{contractVersion:'1.5',tools:[]});
  const receipt=actions.find(x=>x.action==='model-usage/finish').input;
  assert.equal(receipt.outcome,'RETURNED');assert.equal(receipt.inputTokens,null);assert.equal(receipt.outputTokens,null);
  assert.ok(actions.filter(x=>x.action==='check').length>=2);
 }finally{tasks.stop();await close(platform)}
});

import {mkdtemp,chmod,readdir,readFile,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {DelegatedModelFiles} from '../dist/runtime/delegated-model-files.js';
test('private transport carries real request, rejects symlinks and cancels missing responses',async()=>{
 const root=await mkdtemp(join(tmpdir(),'delegated-test-'));await chmod(root,0o700);
 try{
  for(const kind of ['valid','symlink','cancel']){
   const abort=new AbortController();const before=await readdir(root);const model=new DelegatedModel(task,attempt,new DelegatedModelFiles(root));
   const pending=(async()=>{const parts=[];for await(const p of model.generate({messages:[],tools:[],maxTokens:100,signal:abort.signal}))parts.push(p);return parts})();
   const settled=pending.then(value=>({value}),error=>({error}));let dir;
   for(let i=0;i<100;i++){dir=(await readdir(root)).find(x=>!before.includes(x));if(dir)break;await delay(5)}
   const path=join(root,dir);let raw;
   for(let i=0;i<100;i++){try{raw=JSON.parse(await readFile(join(path,'request.json'),'utf8'));break}catch{await delay(5)}}
   if(kind==='valid')await writeFile(join(path,'response.json'),JSON.stringify(response(raw)),{mode:0o600});
   if(kind==='symlink'){await writeFile(join(path,'other.json'),JSON.stringify(response(raw)),{mode:0o600});await symlink(join(path,'other.json'),join(path,'response.json'))}
   if(kind==='cancel')abort.abort();
   const result=await settled;if(kind==='valid')assert.equal(result.value[0].type,'text');else assert.ok(result.error);
  }
 }finally{await rm(root,{recursive:true,force:true})}
});

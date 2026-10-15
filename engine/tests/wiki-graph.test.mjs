import {test} from 'node:test';
import assert from 'node:assert/strict';
import {wikiGraphContext,validateWikiGraph,analyzeWikiGraph} from '../dist/runtime/wiki-graph.js';
const context=wikiGraphContext({documents:[{id:'a',revision:1,title:'交付规范',content:'交付时应逐项核对原件。'},{id:'b',revision:2,title:'验收方法',content:'验收时应逐项核对原件。'}]});
const graph={selected:['a','b'],relations:[{from:'a',to:'b',kind:'topic',reason:'均要求核对原件',evidence:[{articleId:'a',quote:'应逐项核对原件'},{articleId:'b',quote:'应逐项核对原件'}]}]};
test('graph validates bounded knowledge and both endpoint verbatim evidence',()=>{
 assert.deepEqual(validateWikiGraph(graph,context),graph);
 for(const bad of [{...graph,selected:['a','a']},{...graph,selected:['foreign']},{...graph,relations:[{...graph.relations[0],to:'a'}]},{...graph,relations:[...graph.relations,...graph.relations]},{...graph,relations:[{...graph.relations[0],evidence:[{articleId:'a',quote:'凭空编造的不存在内容'},{articleId:'b',quote:'应逐项核对原件'}]}]},{...graph,relations:[{...graph.relations[0],evidence:[{articleId:'a',quote:'应逐项核对原件'},{articleId:'a',quote:'应逐项核对原件'}]}]}])assert.throws(()=>validateWikiGraph(bad,context),/INVALID_WIKI_RESULT/);
 assert.throws(()=>wikiGraphContext({documents:[...context.documents,...context.documents]}),/INVALID_WIKI_SOURCE/);
 assert.deepEqual(validateWikiGraph({selected:['a'],relations:[]},context).relations,[]);
});
test('graph uses one Harness call without executable tools',async()=>{
 let calls=0;const model={async *generate(request){calls++;assert.deepEqual(request.tools,[]);assert.ok(JSON.stringify(request.messages).includes('不宣称已验证业务依赖'));yield {type:'text',text:JSON.stringify(graph)};yield {type:'finish',reason:'stop'};}};
 const result=await analyzeWikiGraph(context,model,new AbortController().signal);assert.equal(calls,1);assert.equal(result.modelCalls,1);
});
import {createServer} from 'node:http';
import {listen,close,json,body} from './fixtures/agent.mjs';
import {AgentTasks} from '../dist/runtime/agent-task.js';
test('graph task meters usage and discards result after knowledge revision changes',async()=>{
 for(const change of [false,true]){
  const actions=[];let generated=false;
  const platform=createServer(async(req,res)=>{const action=req.url.split('/').slice(5).join('/');const input=await body(req);actions.push({action,input});
   if(action==='check')return json(res,{allowed:true,executionClass:'verification',wikiGraph:generated&&change?{documents:context.documents.map(d=>({...d,revision:d.revision+1}))}:context});
   if(action==='model-usage/open')return json(res,{contractVersion:'1.0',maxModelCalls:8,maxOutputTokens:2048});
   if(['execution/open','model-usage/start','model-usage/finish'].includes(action))return json(res,{accepted:true});return json(res,{},400);
  });
  const url=await listen(platform);const backend={lastUsage:null,usage:null,async *generate(request){assert.deepEqual(request.tools,[]);yield {type:'text',text:JSON.stringify(graph)};this.lastUsage={inputTokens:20,outputTokens:10};this.usage=this.lastUsage;generated=true;yield {type:'finish',reason:'stop'};}};
  const tasks=new AgentTasks({platformBaseUrl:url,executionClass:'verification',modelName:'fixture',createModel:()=>backend,routineModel:{modelName:'plus',createModel:()=>{throw Error('graph must retain base')}}});const request={contractVersion:'1.5',taskId:'00000000-0000-4000-8000-000000000011',attemptId:'00000000-0000-4000-8000-000000000012',prompt:'synthetic'};
  try{if(change)await assert.rejects(()=>tasks.run(request,new AbortController().signal),/TASK_ACCESS_DENIED/);else{const result=await tasks.run(request,new AbortController().signal);assert.deepEqual(result.sourceIds,[]);assert.equal(result.outcome,'COMPLETE');}
   assert.deepEqual(actions.find(a=>a.action==='execution/open').input,{contractVersion:'1.5',tools:[]});assert.ok(actions.some(a=>a.action==='model-usage/finish'));assert.ok(actions.every(a=>['check','execution/open','model-usage/open','model-usage/start','model-usage/finish'].includes(a.action)));
  }finally{tasks.stop();await close(platform);}
 }
});

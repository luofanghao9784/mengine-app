import {test} from 'node:test';import assert from 'node:assert/strict';
import {wikiInsightContext,validateWikiInsight,analyzeWikiInsight} from '../dist/runtime/wiki-insight.js';
const doc=(id,anchor=true)=>({id,versionId:'version-'+id,version:1,title:'合成来源',anchor,fragments:[{id:'chunk-'+id,locator:'1',content:'合成交付必须核对原件。'}]});
const evidence=id=>({materialId:id,chunkId:'chunk-'+id,quote:'合成交付必须核对原件'});
const point=id=>({text:'核对原件',evidence:[evidence(id)]});
const context=wikiInsightContext({mode:'ANALYZE',documents:[doc('a'),doc('b')]});
const report={nodes:['a','b'].map(materialId=>({materialId,summary:point(materialId),takeaways:[point(materialId)]})),synthesis:{text:'根据两份资料核对',evidence:[evidence('a'),evidence('b')]},relations:[],recommendations:[]};
test('source analysis requires each source and fully cited synthesis',()=>{
 assert.deepEqual(validateWikiInsight(report,context),report);
 for(const bad of [{...report,nodes:report.nodes.slice(0,1)},{...report,synthesis:point('a')},{...report,synthesis:{text:'伪造',evidence:[{...evidence('a'),quote:'来源没有这段原文'},evidence('b')]}},{...report,nodes:[{...report.nodes[0],extra:true},report.nodes[1]]}])assert.throws(()=>validateWikiInsight(bad,context),/INVALID_WIKI_RESULT/);
});
test('recommendations require non-anchor target, two endpoints and no duplicates',()=>{
 const c=wikiInsightContext({mode:'RECOMMEND',documents:[doc('a'),doc('b',false)]});const rec={document:'b',anchor:'a',reason:'同一交付依据',evidence:[evidence('a'),evidence('b')]};const value={nodes:[],synthesis:null,relations:[],recommendations:[rec]};assert.deepEqual(validateWikiInsight(value,c),value);
 for(const r of [[{...rec,document:'a'}],[rec,rec],[{...rec,evidence:[evidence('a')]}]])assert.throws(()=>validateWikiInsight({...value,recommendations:r},c),/INVALID_WIKI_RESULT/);
 assert.deepEqual(validateWikiInsight({...value,recommendations:[]},c).recommendations,[]);
});
test('single call Harness provides bounded fragments and no executable tools',async()=>{let count=0;const model={async *generate(request){count++;assert.deepEqual(request.tools,[]);assert.ok(JSON.stringify(request.messages).includes('合成交付必须核对原件'));yield {type:'text',text:JSON.stringify(report)};yield {type:'finish',reason:'stop'};}};const result=await analyzeWikiInsight(context,model,new AbortController().signal);assert.equal(result.modelCalls,1);assert.equal(count,1);assert.throws(()=>wikiInsightContext({mode:'GRAPH',documents:[{...doc('a'),fragments:[{id:'c',content:'x'.repeat(3001)}]}]}),/INVALID_WIKI_SOURCE/);});
import {createServer} from 'node:http';import {listen,close,json,body} from './fixtures/agent.mjs';import {AgentTasks} from '../dist/runtime/agent-task.js';
test('source insight branch meters and reauthorizes without generic capabilities',async()=>{
 for(const revoke of [false,true]){let generated=false;const actions=[];const platform=createServer(async(req,res)=>{const action=req.url.split('/').slice(5).join('/');await body(req);actions.push(action);if(action==='check')return generated&&revoke?json(res,{},403):json(res,{allowed:true,executionClass:'verification',wikiInsight:context});if(action==='model-usage/open')return json(res,{contractVersion:'1.0',maxModelCalls:8,maxOutputTokens:2048});if(['execution/open','model-usage/start','model-usage/finish'].includes(action))return json(res,{accepted:true});return json(res,{},400);});const url=await listen(platform);const backend={lastUsage:null,usage:null,async *generate(request){assert.deepEqual(request.tools,[]);yield {type:'text',text:JSON.stringify(report)};this.lastUsage={inputTokens:20,outputTokens:10};this.usage=this.lastUsage;generated=true;yield {type:'finish',reason:'stop'};}};const tasks=new AgentTasks({platformBaseUrl:url,executionClass:'verification',modelName:'fixture',createModel:()=>backend});
 try{const req={contractVersion:'1.5',taskId:'00000000-0000-4000-8000-000000000011',attemptId:'00000000-0000-4000-8000-000000000012',prompt:'synthetic'};if(revoke)await assert.rejects(()=>tasks.run(req,new AbortController().signal),/TASK_ACCESS_DENIED/);else assert.equal((await tasks.run(req,new AbortController().signal)).outcome,'COMPLETE');assert.ok(actions.includes('model-usage/finish'));assert.ok(actions.every(a=>['check','execution/open','model-usage/open','model-usage/start','model-usage/finish'].includes(a)));}finally{tasks.stop();await close(platform);}}
});

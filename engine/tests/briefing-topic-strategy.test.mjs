import test from 'node:test';
import assert from 'node:assert/strict';
import { briefingPhase, briefingPhaseAllows, topicSelectionTool, topicNextTool } from '../dist/runtime/briefing-topic-strategy.js';
test('closed reads still allow a bounded calculation; verified calculation closes every tool except delivery',()=>{
 const p=briefingPhase(false,3);assert.equal(p,'CALCULATION_OR_DELIVERY');
 for(const name of ['compare_dataset','compare_table','deliver_briefing','task_control'])assert.ok(briefingPhaseAllows(p,name));
 for(const name of ['task_context','search_sources','read_original'])assert.ok(!briefingPhaseAllows(p,name));
 const ready=briefingPhase(true,3);assert.ok(briefingPhaseAllows(ready,'deliver_briefing'));assert.ok(!briefingPhaseAllows(ready,'compare_dataset'));
});
test('topic selection is an audited proposal, not calculation proof; invalid DATA candidate does not invoke backend',async()=>{
 let calls=0,selected=false;
 const tool=topicSelectionTool(async body=>{calls++;return {recorded:true,proposalOnly:true,selectedIndex:body.selectedIndex,strategyVersion:'1.0.0'};},()=>{selected=true;});
 const candidate={question:'合成门店收款是否变化',evidenceNeeded:'需要全量月份比较',requiresCalculation:true,difference:'近期没有门店对比',businessType:'DATA'};
 await assert.rejects(tool.execute({candidates:[{...candidate,requiresCalculation:false}],selectedIndex:0},new AbortController().signal));assert.equal(calls,0);
 const result=await tool.execute({candidates:[candidate],selectedIndex:0},new AbortController().signal);assert.equal(calls,1);assert.ok(selected);assert.ok(result.proposalOnly);assert.equal(result.selectedCandidate.question,candidate.question);
});
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { AgentTasks } from '../dist/runtime/agent-task.js';
import { listen, close, body, json } from './fixtures/agent.mjs';
import { usageFixture } from './fixtures/usage.mjs';
test('actual generation gates delivery on an authorized topic proposal and records both tool receipts',async t=>{
 let selected=false,calls=0;const receipts=[];
 const platform=createServer(async(req,res)=>{
  if(usageFixture(req,res))return;const input=await body(req);
  if(req.url.endsWith('/check'))return json(res,{allowed:true,executionClass:'live',briefingGeneration:true,briefingContentVersion:'1.0',topicStrategyVersion:'1.0',topicSelectionRecorded:selected});
  if(req.url.endsWith('/execution/open'))return json(res,{accepted:true,policy:'READ_ONLY_PRIVATE_V1'});
  if(req.url.endsWith('/execution/tool')){receipts.push(input);return json(res,{accepted:true});}
  if(req.url.endsWith('/select-briefing-topic')){selected=true;return json(res,{recorded:true,proposalOnly:true,selectedIndex:0,strategyVersion:'1.0.0'});}
  if(req.url.endsWith('/deliver-briefing'))return json(res,{contractVersion:'1.0',status:'NO_NEW_CONTENT',reason:'NO_USEFUL_CONTENT'});
  json(res,{},404);
 });const url=await listen(platform);t.after(()=>close(platform));
 const agent=new AgentTasks({platformBaseUrl:url,executionClass:'live',modelName:'synthetic-topic',createModel:()=>({usage:null,async *generate(request){
  calls++;
  if(calls===1){assert.ok(!request.tools.some(x=>x.name==='deliver_briefing'));yield {type:'tool_call',id:'topic',name:'select_briefing_topic',arguments:JSON.stringify({candidates:[{question:'是否有新发现',evidenceNeeded:'需要新增资料',requiresCalculation:false,difference:'当前没有新增证据',businessType:'INSIGHT'}],selectedIndex:0})};}
  else {assert.ok(request.tools.some(x=>x.name==='deliver_briefing'));assert.ok(!request.tools.some(x=>x.name==='select_briefing_topic'));yield {type:'tool_call',id:'end',name:'deliver_briefing',arguments:JSON.stringify({title:'暂无新内容',summary:'本次获权范围暂无新证据。',analysis:['不能断言全部资料已经分析完毕。'],businessType:'INSIGHT'})};}
  yield {type:'finish',reason:'tool_calls'};
 }})});
 const result=await agent.run({contractVersion:'1.5',taskId:randomUUID(),attemptId:randomUUID(),prompt:'合成选题验证'},new AbortController().signal);
 assert.equal(calls,2);assert.equal(result.outcome,'COMPLETE');assert.deepEqual(receipts.filter(x=>x.status==='succeeded').map(x=>x.name),['select_briefing_topic','deliver_briefing']);
});

test('selected topic directs one calculation without forcing retries after a failed calculation',()=>{
 assert.equal(topicNextTool(true,0,true,true),'compare_dataset');assert.equal(topicNextTool(true,0,false,true),'compare_table');
 assert.equal(topicNextTool(true,1,true,true),undefined);assert.equal(topicNextTool(false,0,true,true),'deliver_briefing');assert.equal(topicNextTool(true,0,false,false),undefined);
});

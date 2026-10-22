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
 const candidate={goal:'核查收款变化',destination:'BRIEFING',userValue:'识别需要核对的变化',question:'合成门店收款是否变化',evidenceNeeded:'需要全量月份比较',requiresCalculation:true,difference:'近期没有门店对比',businessType:'DATA'};
 await assert.rejects(tool.execute({candidates:[{...candidate,requiresCalculation:false}],selectedIndex:0},new AbortController().signal));assert.equal(calls,0);
 const result=await tool.execute({candidates:[candidate],selectedIndex:0},new AbortController().signal);assert.equal(calls,1);assert.ok(selected);assert.ok(result.proposalOnly);assert.equal(result.selectedCandidate.question,candidate.question);
});
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { AgentTasks } from '../dist/runtime/agent-task.js';
import { listen, close, body, json } from './fixtures/agent.mjs';
import { usageFixture } from './fixtures/usage.mjs';
for (const requestedType of ['', 'SUGGESTION']) test(`actual generation gates delivery and retains requested type ${requestedType || 'AUTO'}`,async t=>{
 let selected=false,calls=0;const receipts=[];
 const platform=createServer(async(req,res)=>{
  if(usageFixture(req,res))return;const input=await body(req);
  if(req.url.endsWith('/check'))return json(res,{allowed:true,executionClass:'live',briefingGeneration:true,briefingContentVersion:'1.0',contextVersion:'1.0',datasetContextVersion:'1.0',datasetComparisonVersion:'1.0',topicStrategyVersion:'1.0',editorialPlanVersion:'1.0',briefingRequestedType:requestedType,topicSelectionRecorded:selected});
  if(req.url.endsWith('/context'))return json(res,{contractVersion:'1.0',action:input.action,referenceOnly:true,result:{}});
  if(req.url.endsWith('/execution/open'))return json(res,{accepted:true,policy:'READ_ONLY_PRIVATE_V1'});
  if(req.url.endsWith('/execution/tool')){receipts.push(input);return json(res,{accepted:true});}
  if(req.url.endsWith('/select-briefing-topic')){assert.equal(input.candidates[0].businessType,requestedType || 'INSIGHT');selected=true;return json(res,{recorded:true,proposalOnly:true,selectedIndex:0,strategyVersion:'1.0.0'});}
  if(req.url.endsWith('/deliver-briefing')){assert.equal(input.businessType,requestedType || 'INSIGHT');return json(res,{contractVersion:'1.0',status:'NO_NEW_CONTENT',reason:'NO_USEFUL_CONTENT'});}
  json(res,{},404);
 });const url=await listen(platform);t.after(()=>close(platform));
 const agent=new AgentTasks({platformBaseUrl:url,executionClass:'live',modelName:'synthetic-topic',createModel:()=>({usage:null,async *generate(request){
  calls++;
  assert.ok(!request.tools.some(x=>x.name==='compare_dataset'),'no published plan must not advertise dataset calculation');
  if(calls===1){assert.ok(!request.tools.some(x=>x.name==='deliver_briefing'));yield {type:'tool_call',id:'topic',name:'select_briefing_topic',arguments:JSON.stringify({candidates:[{goal:'推进工作',destination:'NO_OUTPUT',userValue:'证据不足不凑内容',question:'是否有新发现',evidenceNeeded:'需要新增资料',requiresCalculation:false,difference:'当前没有新增证据',businessType:requestedType || 'INSIGHT'}],selectedIndex:0,editorialPlan:{batchId:'00000000-0000-4000-8000-000000000001',audienceKey:'key',items:[{goalRef:'governance',questionKey:'q',scope:'s',period:'p',shape:'NARRATIVE',decision:'SKIP',mergeInto:-1,reason:'无新证据'}]}})};}
  else {assert.ok(request.tools.some(x=>x.name==='deliver_briefing'));assert.ok(!request.tools.some(x=>x.name==='select_briefing_topic'));yield {type:'tool_call',id:'end',name:'deliver_briefing',arguments:JSON.stringify({title:'暂无新内容',summary:'本次获权范围暂无新证据。',analysis:['不能断言全部资料已经分析完毕。'],businessType:requestedType || 'INSIGHT'})};}
  yield {type:'finish',reason:'tool_calls'};
 }})});
 const result=await agent.run({contractVersion:'1.5',taskId:randomUUID(),attemptId:randomUUID(),prompt:'合成选题验证'},new AbortController().signal);
 assert.equal(calls,2);assert.equal(result.outcome,'COMPLETE');assert.deepEqual(receipts.filter(x=>x.status==='succeeded').map(x=>x.name),['select_briefing_topic','deliver_briefing']);
});

test('selected topic directs one calculation without forcing retries after a failed calculation',()=>{
 assert.equal(topicNextTool(true,0,true,true),'compare_dataset');assert.equal(topicNextTool(true,0,false,true),'compare_table');
 assert.equal(topicNextTool(true,1,true,true),undefined);assert.equal(topicNextTool(false,0,true,true),'deliver_briefing');assert.equal(topicNextTool(true,0,false,false),undefined);
});

test('wrong requested topic is rejected locally without backend or selection side effects',async()=>{
 let calls=0;const tool=topicSelectionTool(async()=>{calls++;},()=>{calls++;},'SUGGESTION');
 assert.ok(tool.parameters.properties.candidates.items.properties.businessType.enum.includes('SUGGESTION'));
 await assert.rejects(tool.execute({candidates:[{question:'问题',evidenceNeeded:'依据',requiresCalculation:true,difference:'区别',businessType:'DATA'}],selectedIndex:0},new AbortController().signal),e=>e.code==='BRIEFING_TYPE_MISMATCH');assert.equal(calls,0);
});
import { briefingDeliveryTool, BRIEFING_EDITORIAL_HINTS } from '../dist/runtime/briefing-delivery.js';
test('delivery requires requested type and exposes a static correction without sending the wrong card',async()=>{
 let invokes=0;
 const tool=briefingDeliveryTool({requestedType:'SUGGESTION',authorize:async()=>{},invoke:async()=>{invokes++;return {};}});
 assert.deepEqual(tool.parameters.properties.businessType.enum,['SUGGESTION']);assert.ok(tool.parameters.required.includes('businessType'));
 await assert.rejects(tool.execute({businessType:'DATA',title:'合成标题',summary:'合成摘要',analysis:['一','二']},new AbortController().signal),e=>e.code==='BRIEFING_TYPE_MISMATCH');
 assert.equal(invokes,0);assert.match(BRIEFING_EDITORIAL_HINTS.BRIEFING_TYPE_MISMATCH,/does not change the requested type/);
});

test('general editorial tool carries mixed-type whole batch without imposing requested type on other items',async()=>{
 let saved;
 const tool=topicSelectionTool(async body=>{saved=body;return {recorded:true,proposalOnly:true,selectedIndex:1,strategyVersion:'1.0.0'};},()=>{},'SUGGESTION',true);
 assert.ok(tool.parameters.required.includes('editorialPlan'));
 const candidates=['DATA','SUGGESTION'].map(businessType=>({question:'具体业务问题',goal:'实际目标',userValue:'下一步处理',destination:'BRIEFING',evidenceNeeded:'实际证据',difference:'不同业务问题',requiresCalculation:businessType==='DATA',businessType}));
 const editorialPlan={batchId:'00000000-0000-4000-8000-000000000001',audienceKey:'key',items:candidates.map((c,i)=>({goalRef:'governance',questionKey:'q'+i,scope:'授权门店',period:'既有期间',shape:i?'STEPS':'COMPARISON',decision:'EMIT',mergeInto:-1,reason:'独立问题'}))};
 await tool.execute({candidates,selectedIndex:1,editorialPlan},new AbortController().signal);assert.deepEqual(saved.editorialPlan,editorialPlan);
 await assert.rejects(tool.execute({candidates,selectedIndex:1},new AbortController().signal));
});


test('authorized reader version is bound by runtime, without changing model business proposals', async () => {
 const key='a'.repeat(32); let saved,selected=false;
 const tool=topicSelectionTool(async body=>{saved=body;return {recorded:true,proposalOnly:true,selectedIndex:0,strategyVersion:'1.0.0'};},()=>{selected=true;},'',true,'',key);
 assert.ok(!tool.parameters.properties.editorialPlan.required.includes('audienceKey'));
 const candidate={question:'核查已确认事项',goal:'核对进展',userValue:'安排接续',destination:'BRIEFING',evidenceNeeded:'实际资料',difference:'新事项',requiresCalculation:false,businessType:'INSIGHT'};
 const plan={batchId:randomUUID(),audienceKey:'model-copied-wrong-key',items:[{goalRef:'governance',questionKey:'follow-up',scope:'授权范围',period:'资料覆盖期间',shape:'NARRATIVE',decision:'EMIT',mergeInto:-1,reason:'新业务发现'}]};
 await tool.execute({candidates:[candidate],selectedIndex:0,editorialPlan:plan},new AbortController().signal);
 assert.equal(saved.editorialPlan.audienceKey,key);assert.equal(plan.audienceKey,'model-copied-wrong-key');
 assert.equal(saved.editorialPlan.batchId,plan.batchId);assert.deepEqual(saved.editorialPlan.items,plan.items);assert.deepEqual(saved.candidates,[candidate]);assert.ok(selected);
 selected=false;
 const denied=topicSelectionTool(async()=>{throw Object.assign(new Error('denied'),{code:'REMOTE_ACCESS_DENIED'});},()=>{selected=true;},'',true,'',key);
 await assert.rejects(denied.execute({candidates:[candidate],selectedIndex:0,editorialPlan:plan},new AbortController().signal),{code:'REMOTE_ACCESS_DENIED'});
 assert.equal(selected,false);
});


test('automatic editorial generation can deliver its planned STEPS layout with platform reader binding',async t=>{
 const key='b'.repeat(32), artifact=randomUUID();let selected=false,delivered=false,calls=0;
 const server=createServer(async(req,res)=>{
  if(usageFixture(req,res))return;const input=await body(req);
  if(req.url.endsWith('/check'))return json(res,{allowed:true,executionClass:'live',briefingGeneration:true,briefingContentVersion:'1.0',briefingPresentationVersion:'1.0',topicStrategyVersion:'1.0',editorialPlanVersion:'1.0',topicSelectionRecorded:selected,workAudience:{version:'1.0',key,role:'OWNER',roleLabel:'负责人',department:'合成部门',jobTitle:'负责人',responsibilities:'核对进展',focus:[],focusLabels:[],starters:[],configured:true,authority:false,goals:{governance:'推进接续',stage:'',followUp:''}}});
  if(req.url.endsWith('/execution/open'))return json(res,{accepted:true,policy:'READ_ONLY_PRIVATE_V1'});
  if(req.url.endsWith('/execution/tool'))return json(res,{accepted:true});
  if(req.url.endsWith('/select-briefing-topic')){assert.equal(input.editorialPlan.audienceKey,key);selected=true;return json(res,{recorded:true,proposalOnly:true,selectedIndex:0,strategyVersion:'1.0.0'});}
  if(req.url.endsWith('/deliver-briefing')){assert.equal(input.presentation.layout,'STEPS');assert.equal(input.presentation.sections.length,2);delivered=true;return json(res,{contractVersion:'1.0',status:'PREPARED',artifactId:artifact,title:input.title,visibility:'PRIVATE_AFTER_TASK_SUCCEEDS'});}
  return json(res,{},404);
 });const url=await listen(server);t.after(()=>close(server));
 const agent=new AgentTasks({platformBaseUrl:url,executionClass:'live',modelName:'synthetic-editorial-layout',createModel:()=>({usage:null,async *generate(request){
  calls++;
  if(!selected)yield {type:'tool_call',id:'topic',name:'select_briefing_topic',arguments:JSON.stringify({candidates:[{question:'已核对事项如何接续',goal:'推进接续',userValue:'完成下一步核对',destination:'BRIEFING',evidenceNeeded:'获权依据',difference:'新的接续事项',requiresCalculation:false,businessType:'SUGGESTION'}],selectedIndex:0,editorialPlan:{batchId:randomUUID(),audienceKey:'incorrect-model-copy',items:[{goalRef:'governance',questionKey:'follow-up',scope:'授权范围',period:'本轮',shape:'STEPS',decision:'EMIT',mergeInto:-1,reason:'已有实际接续事项'}]}})};
  else {
   const tool=request.tools.find(x=>x.name==='deliver_briefing');assert.ok(tool.parameters.properties.presentation,'automatic tasks need the same layout protocol as backend editorial validation');
   yield {type:'tool_call',id:'deliver',name:'deliver_briefing',arguments:JSON.stringify({businessType:'SUGGESTION',title:'请先核对凭证再接续处理',summary:'请依据现有的核对记录安排下一步接续。',analysis:['先核对原始凭证与已有记录是否一致。','再将仍有疑问的事项交给负责人接续处理。'],presentation:{version:'briefing-presentation-v1',layout:'STEPS',chartStyle:null,focusGroup:null,focusValue:null,sections:[{paragraphIndex:0,role:'ACTION'},{paragraphIndex:1,role:'ACTION'}]}})};
  }
  yield {type:'finish',reason:'tool_calls'};
 }})});
 const result=await agent.run({contractVersion:'1.5',taskId:randomUUID(),attemptId:randomUUID(),prompt:'合成自动画报协议验证'},new AbortController().signal);
 assert.equal(result.outcome,'COMPLETE');assert.ok(delivered);assert.equal(calls,2);
});


test('planned layout errors identify the repair and never rewrite content or dispatch invalid sections',async()=>{
 let writes=0;
 const tool=briefingDeliveryTool({presentationAvailable:true,selectedType:()=> 'SUGGESTION',selectedShape:()=> 'STEPS',authorize:async()=>{},invoke:async()=>{writes++;return {contractVersion:'1.0',status:'NO_NEW_CONTENT',reason:'NO_USEFUL_CONTENT'};}});
 const good={businessType:'SUGGESTION',title:'核对凭证后接续处理',summary:'先按现有证据核对，再交接剩余问题。',analysis:['先核对原始凭证与已有记录是否一致。','再将仍有疑问的事项交给负责人接续处理。'],presentation:{version:'briefing-presentation-v1',layout:'STEPS',chartStyle:null,focusGroup:null,focusValue:null,sections:[{paragraphIndex:0,role:'ACTION'},{paragraphIndex:1,role:'ACTION'}]}};
 for(const [patch,hint] of [
  [{layout:'EDITORIAL'},/必须为 STEPS/],
  [{focusValue:'CURRENT'},/全部为 null/],
  [{sections:[{paragraphIndex:1,role:'ACTION'},{paragraphIndex:2,role:'ACTION'}]},/0 到 1/],
  [{sections:[{paragraphIndex:0,role:'OBSERVATION'},{paragraphIndex:1,role:'ACTION'}]},/背景观察段落保留/],
 ])await assert.rejects(tool.execute({...good,presentation:{...good.presentation,...patch}},new AbortController().signal),e=>hint.test(e.hint));
 assert.equal(writes,0);const before=JSON.stringify(good);await tool.execute(good,new AbortController().signal);assert.equal(writes,1);assert.equal(JSON.stringify(good),before);
 // No-output receipts do not publish a layout and remain possible after a planned topic.
 await tool.execute({...good,title:'暂无新内容',presentation:{...good.presentation,layout:'EDITORIAL',sections:[]}},new AbortController().signal);assert.equal(writes,2);
});

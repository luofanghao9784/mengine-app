import test from 'node:test';
import assert from 'node:assert/strict';
import {publishedMetricPlans} from '../dist/runtime/published-metric-plans.js';
import {datasetComparisonTool,normalizeDatasetArguments} from '../dist/runtime/dataset-comparison.js';
const id='00000000-0000-4000-8000-000000000001', other='00000000-0000-4000-8000-000000000002';
const plan={datasetId:id,snapshotId:id,metricId:id,metricVersion:2,operation:'SUMMARY',aggregation:'COUNT',groupColumns:[],timeZone:'Asia/Shanghai',groupColumn:null,periodColumn:null,valueColumn:null,baseline:null,current:null,dateColumn:null,dateFrom:null,dateTo:null,missingDates:null,periodMode:null};
const response=()=>({action:'dataset_search',result:{items:[{datasetId:id,snapshotId:id,governedMetrics:{items:[{metricId:id,version:2,executionRequest:structuredClone(plan)}]}}]}});
const selection={datasetId:id,snapshotId:id,metricId:id,metricVersion:2};
function receipt(body){return {contractVersion:'1.0',status:'COMPUTED',datasetSource:{datasetId:id,snapshotId:id,version:1,name:'synthetic',sha256:'a'.repeat(64),rowCount:2,collectedAt:'2026-10-16T00:00:00Z',coverageThrough:null},calculation:{recipeVersion:'dataset-summary-1',status:'COMPUTED',request:structuredClone(body),inputSha256:'a'.repeat(64),matchedRows:2,ignoredRows:0,missingDateRows:0,rows:[{group:[],value:'2',records:2}],total:'2'},artifact:{id,filename:'dataset-comparison-'+ 'b'.repeat(20)+'.json',sha256:'b'.repeat(64),bytes:100}};}
test('metric selection executes exact published scope regardless of model arithmetic fields',async()=>{
 const plans=publishedMetricPlans();plans.record(response());let sent;let verified=0;
 const tool=datasetComparisonTool({resolveMetricPlan:plans.resolve,authorize:async()=>{},invoke:async body=>{sent=body;return receipt(body)},onVerified:()=>verified++});
 const out=await tool.execute({...selection,operation:'COMPARE',aggregation:'SUM',valueColumn:'invented',groupColumns:['invented'],dateFrom:'2099-01-01'},new AbortController().signal);
 assert.deepEqual(sent,normalizeDatasetArguments(plan));assert.equal(out.calculation.total,'2');assert.equal(verified,1);
});
test('unretrieved metrics, wrong versions and snapshot substitution never reach computation',async()=>{
 const plans=publishedMetricPlans();plans.record(response());
 const tool=datasetComparisonTool({resolveMetricPlan:plans.resolve,authorize:async()=>{},invoke:async()=>assert.fail('must not calculate')});
 for(const change of [{metricId:other},{metricVersion:3},{datasetId:other},{snapshotId:other}])await assert.rejects(tool.execute({...selection,...change},new AbortController().signal),{code:'METRIC_DEFINITION_REQUIRED'});
 assert.throws(()=>publishedMetricPlans().resolve(selection),{code:'METRIC_DEFINITION_REQUIRED'});
});
test('only platform dataset context shapes supply plans; identities must match and copies are isolated',()=>{
 const plans=publishedMetricPlans();plans.record({action:'search',result:response().result});assert.throws(()=>plans.resolve(selection));
 const r=response();plans.record(r);r.result.items[0].governedMetrics.items[0].executionRequest.aggregation='SUM';assert.equal(plans.resolve(selection).aggregation,'COUNT');
 const changed=plans.resolve(selection);changed.groupColumns.push('tamper');assert.deepEqual(plans.resolve(selection).groupColumns,[]);
 r.result.items[0].governedMetrics.items[0].executionRequest.snapshotId=other;assert.throws(()=>plans.record(r),{code:'INVALID_CONTEXT_RESPONSE'});
});
test('published execution still obeys capability and authorization checks',async()=>{
 const plans=publishedMetricPlans();plans.record(response());
 const tool=datasetComparisonTool({resolveMetricPlan:plans.resolve,allowSummary:false,authorize:async()=>{},invoke:async()=>assert.fail('must not calculate')});
 await assert.rejects(tool.execute(selection,new AbortController().signal),{code:'INVALID_TOOL_ARGUMENTS'});
 const denied=datasetComparisonTool({resolveMetricPlan:plans.resolve,authorize:async()=>{throw Error('denied')},invoke:async()=>assert.fail('must not calculate')});
 await assert.rejects(denied.execute(selection,new AbortController().signal),/denied/);
});
test('tampered calculation receipt cannot become a verified briefing result',async()=>{
 const plans=publishedMetricPlans();plans.record(response());
 const tool=datasetComparisonTool({resolveMetricPlan:plans.resolve,authorize:async()=>{},invoke:async body=>{const out=receipt(body);out.calculation.request.metricVersion=9;return out},onVerified:()=>assert.fail('must not deliver')});
 await assert.rejects(tool.execute(selection,new AbortController().signal),{code:'DATASET_RESULT_INVALID'});
});

test('automatic briefing retrieves a metric, selects its topic, calculates and delivers in four model turns',async t=>{
 const {createServer}=await import('node:http');const {randomUUID}=await import('node:crypto');
 const {AgentTasks}=await import('../dist/runtime/agent-task.js');
 const {listen,close,body,json}=await import('./fixtures/agent.mjs');const {usageFixture}=await import('./fixtures/usage.mjs');
 let selected=false,calculated=false,delivered=false,calls=0;const steps=[];
 const source={datasetId:id,snapshotId:id,version:1,name:'合成订单登记',description:'登记记录数量',columns:['id'],totalColumns:1,columnOffset:0,nextColumnOffset:null,rowCount:2,coverageThrough:null,collectedAt:'2026-10-16T00:00:00Z',authority:false,governedMetrics:response().result.items[0].governedMetrics};
 const server=createServer(async(req,res)=>{
  if(usageFixture(req,res))return;const input=await body(req);
  if(req.url.endsWith('/check'))return json(res,{allowed:true,executionClass:'live',briefingGeneration:true,briefingPresentationVersion:'1.0',briefingContentVersion:'1.0',topicStrategyVersion:'1.0',topicSelectionRecorded:selected,contextVersion:'1.0',datasetContextVersion:'1.0',datasetComparisonVersion:'1.0',datasetAnalysisVersion:'1.0',datasetBriefingSummaryVersion:'1.0'});
  if(req.url.endsWith('/execution/open'))return json(res,{accepted:true,policy:'READ_ONLY_PRIVATE_V1'});
  if(req.url.endsWith('/execution/tool'))return json(res,{accepted:true});
  if(req.url.endsWith('/context'))return json(res,{contractVersion:'1.0',action:input.action,referenceOnly:true,result:input.action==='bootstrap'?{}:{items:[source],hasMore:false}});
  if(req.url.endsWith('/select-briefing-topic')){selected=true;steps.push('topic');return json(res,{recorded:true,proposalOnly:true,selectedIndex:0,strategyVersion:'1.0.0'});}
  if(req.url.endsWith('/compare-dataset')){assert.ok(selected);assert.deepEqual(input,normalizeDatasetArguments(plan));calculated=true;steps.push('calculation');return json(res,receipt(input));}
  if(req.url.endsWith('/deliver-briefing')){assert.ok(calculated);assert.equal(input.calculationArtifactId,id);delivered=true;steps.push('delivery');return json(res,{contractVersion:'1.0',status:'PREPARED',artifactId:other,title:input.title,visibility:'PRIVATE_AFTER_TASK_SUCCEEDS'});}
  return json(res,{},404);
 });
 const url=await listen(server);t.after(()=>close(server));
 const agent=new AgentTasks({platformBaseUrl:url,executionClass:'live',modelName:'synthetic',createModel:()=>({usage:null,async *generate(request){
  calls++;
  if(calls===2){assert.equal(request.requiredTool,'select_briefing_topic');assert.ok(!request.tools.some(t=>t.name==='task_context'));}
  if(calls===3)assert.equal(request.requiredTool,'compare_dataset');
  if(calls===4){const delivery=request.tools.find(t=>t.name==='deliver_briefing');assert.ok(delivery);assert.equal(delivery.parameters.properties.presentation,undefined);}const choices=[['task_context',{action:'dataset_search'}],['select_briefing_topic',{candidates:[{question:'订单登记记录数量是多少？',evidenceNeeded:'已发布记录数指标',requiresCalculation:true,difference:'首次按登记记录口径交付',businessType:'DATA'}],selectedIndex:0}],['compare_dataset',selection],['deliver_briefing',{businessType:'DATA',calculationArtifactId:id,title:'订单登记共有2条记录',summary:'按已发布记录数口径统计，共有2条登记记录。',analysis:['记录数量由固定计划计算得出，共2条。','此数值表示登记记录，不代表有效订单数或客户人数。']}]];
  assert.ok(calls<=4);const [name,args]=choices[calls-1];yield {type:'tool_call',id:'step-'+calls,name,arguments:JSON.stringify(args)};yield {type:'finish',reason:'tool_calls'};
 }})});
 const result=await agent.run({contractVersion:'1.5',taskId:randomUUID(),attemptId:randomUUID(),prompt:'按已发布指标生成画报'},new AbortController().signal);
 assert.equal(result.outcome,'COMPLETE');assert.ok(delivered);assert.equal(calls,4);assert.deepEqual(steps,['topic','calculation','delivery']);
});

test('automatic fixed-plan interface exposes only metric selection and rejects free arithmetic',async()=>{
 const plans=publishedMetricPlans();plans.record(response());let called=0;
 const tool=datasetComparisonTool({fixedPlanOnly:true,resolveMetricPlan:plans.resolve,authorize:async()=>{},invoke:async b=>{called++;return receipt(b)}});
 assert.deepEqual(Object.keys(tool.parameters.properties).sort(),['datasetId','metricId','metricVersion','snapshotId']);
 assert.equal(tool.parameters.required.length,4);
 await assert.rejects(tool.execute({datasetId:id,snapshotId:id,operation:'SUMMARY'},new AbortController().signal),{code:'METRIC_DEFINITION_REQUIRED'});
 await assert.rejects(tool.execute({...selection,aggregation:'COUNT'},new AbortController().signal),{code:'METRIC_DEFINITION_REQUIRED'});
 await tool.execute(selection,new AbortController().signal);assert.equal(called,1);
});

test('automatic briefing calculates two verified metrics in one tool turn before delivery',async t=>{
 const {createServer}=await import('node:http');const {randomUUID}=await import('node:crypto');
 const {AgentTasks}=await import('../dist/runtime/agent-task.js');
 const {listen,close,body,json}=await import('./fixtures/agent.mjs');const {usageFixture}=await import('./fixtures/usage.mjs');
 let selected=false,calculated=false,delivered=false,calls=0;const steps=[];
 const source={datasetId:id,snapshotId:id,version:1,name:'合成订单登记',description:'登记记录数量',columns:['id'],totalColumns:1,columnOffset:0,nextColumnOffset:null,rowCount:2,coverageThrough:null,collectedAt:'2026-10-16T00:00:00Z',authority:false,governedMetrics:response().result.items[0].governedMetrics};
 source.governedMetrics.items.push({metricId:other,version:2,executionRequest:{...plan,metricId:other}});
 const server=createServer(async(req,res)=>{
  if(usageFixture(req,res))return;const input=await body(req);
  if(req.url.endsWith('/check'))return json(res,{allowed:true,executionClass:'live',briefingGeneration:true,briefingPresentationVersion:'1.0',briefingContentVersion:'1.0',topicStrategyVersion:'1.0',topicSelectionRecorded:selected,contextVersion:'1.0',datasetContextVersion:'1.0',datasetComparisonVersion:'1.0',datasetAnalysisVersion:'1.0',datasetBriefingSummaryVersion:'1.0'});
  if(req.url.endsWith('/execution/open'))return json(res,{accepted:true,policy:'READ_ONLY_PRIVATE_V1'});
  if(req.url.endsWith('/execution/tool'))return json(res,{accepted:true});
  if(req.url.endsWith('/context'))return json(res,{contractVersion:'1.0',action:input.action,referenceOnly:true,result:input.action==='bootstrap'?{}:{items:[source],hasMore:false}});
  if(req.url.endsWith('/select-briefing-topic')){selected=true;steps.push('topic');return json(res,{recorded:true,proposalOnly:true,selectedIndex:0,strategyVersion:'1.0.0'});}
  if(req.url.endsWith('/compare-dataset')){assert.ok(selected);assert.deepEqual(input,normalizeDatasetArguments({...plan,metricId:steps.filter(x=>x==='calculation').length===0?id:other}));calculated=true;steps.push('calculation');return json(res,receipt(input));}
  if(req.url.endsWith('/deliver-briefing')){assert.ok(calculated);assert.equal(input.calculationArtifactId,id);delivered=true;steps.push('delivery');return json(res,{contractVersion:'1.0',status:'PREPARED',artifactId:other,title:input.title,visibility:'PRIVATE_AFTER_TASK_SUCCEEDS'});}
  return json(res,{},404);
 });
 const url=await listen(server);t.after(()=>close(server));
 const agent=new AgentTasks({platformBaseUrl:url,executionClass:'live',modelName:'synthetic',createModel:()=>({usage:null,async *generate(request){
  calls++;
  if(calls===2){assert.equal(request.requiredTool,'select_briefing_topic');assert.ok(!request.tools.some(t=>t.name==='task_context'));}
  if(calls===3)assert.equal(request.requiredTool,'compare_dataset');
  if(calls===4){const delivery=request.tools.find(t=>t.name==='deliver_briefing');assert.ok(delivery);assert.equal(delivery.parameters.properties.presentation,undefined);}const choices=[['task_context',{action:'dataset_search'}],['select_briefing_topic',{candidates:[{question:'订单登记记录数量是多少？',evidenceNeeded:'已发布记录数指标',requiresCalculation:true,difference:'首次按登记记录口径交付',businessType:'DATA'}],selectedIndex:0}],['compare_dataset',{...selection,supportingMetrics:[{...selection,metricId:other}]}],['deliver_briefing',{businessType:'DATA',calculationArtifactId:id,title:'订单登记共有2条记录',summary:'按已发布记录数口径统计，共有2条登记记录。',analysis:['记录数量由固定计划计算得出，共2条。','此数值表示登记记录，不代表有效订单数或客户人数。']}]];
  assert.ok(calls<=4);const [name,args]=choices[calls-1];yield {type:'tool_call',id:'step-'+calls,name,arguments:JSON.stringify(args)};yield {type:'finish',reason:'tool_calls'};
 }})});
 const result=await agent.run({contractVersion:'1.5',taskId:randomUUID(),attemptId:randomUUID(),prompt:'按已发布指标生成画报'},new AbortController().signal);
 assert.equal(result.outcome,'COMPLETE');assert.ok(delivered);assert.equal(calls,4);assert.deepEqual(steps,['topic','calculation','calculation','delivery']);
});

test('automatic companions require identical scope and distinct measures, never alternate snapshots or dates',()=>{
 const plans=publishedMetricPlans(),r=response();
 const add=(metricId,changes)=>r.result.items[0].governedMetrics.items.push({metricId,version:2,executionRequest:{...plan,metricId,...changes}});
 add(other,{aggregation:'SUM',valueColumn:'amount'});
 add('00000000-0000-4000-8000-000000000003',{aggregation:'SUM',valueColumn:'amount',dateColumn:'date',dateFrom:'2026-01-01'});
 add('00000000-0000-4000-8000-000000000004',{});
 plans.record(r);assert.deepEqual(plans.companions(selection),[{...selection,metricId:other}]);
 assert.throws(()=>plans.companions({...selection,snapshotId:other}),{code:'METRIC_DEFINITION_REQUIRED'});
});

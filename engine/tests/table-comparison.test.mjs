import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { tableComparisonTool } from '../dist/runtime/table-comparison.js';
import { AgentTasks } from '../dist/runtime/agent-task.js';
import { listen, close, body, json } from './fixtures/agent.mjs';
import { usageFixture } from './fixtures/usage.mjs';

test('fixed comparison cannot call the platform for an ungranted source or conceal a recipe failure', async () => {
  let calls=0;
  const tool=tableComparisonTool({hasSource:id=>id==='granted',authorize:async()=>{},invoke:async()=>{calls++;return {contractVersion:'1.0',status:'FAILED',code:'MISSING_NUMBER:C3'};}});
  await assert.rejects(tool.execute({sourceId:'foreign'},new AbortController().signal),{code:'TABLE_SOURCE_NOT_GRANTED'});
  assert.equal(calls,0);
  await assert.rejects(tool.execute({sourceId:'granted'},new AbortController().signal),{code:'MISSING_NUMBER:C3'});
});

test('live Harness calls the authorized fixed recipe and bases its answer on the actual result',async(t)=>{
  const sourceId=randomUUID(), receipts=[];let modelCalls=0,computations=0;
  const platform=createServer(async(req,res)=>{
    if(usageFixture(req,res))return;
    const input=await body(req);
    if(req.url.endsWith('/check'))return json(res,{allowed:true,executionClass:'live',tableComparisonVersion:'1.0'});
    if(req.url.endsWith('/execution/open')){
      assert.ok(input.tools.includes('compare_table'));assert.ok(!input.tools.includes('run_javascript'));
      return json(res,{accepted:true,policy:'READ_ONLY_PRIVATE_V1'});
    }
    if(req.url.endsWith('/execution/tool')){receipts.push(input);return json(res,{accepted:true});}
    if(req.url.endsWith('/search'))return json(res,{items:[{id:sourceId,filename:'synthetic.xlsx',version:2,locator:'经营 第1–3行',content:'A1="期间" B1="门店" C1="金额"'}]});
    if(req.url.endsWith('/compare-table')){
      computations++;assert.equal(input.sourceId,sourceId);assert.equal(input.valueColumn,'C');
      return json(res,{contractVersion:'1.0',status:'COMPUTED',source:{id:sourceId},calculation:{recipeVersion:'table-compare-1',rows:[{group:'甲',baseline:'0.30',current:'0.60',difference:'0.30',changePercent:'100.00',baselineRank:2,currentRank:1}]},artifact:{filename:'table-comparison-12345678901234567890.json'}});
    }
    json(res,{},404);
  });
  const url=await listen(platform);t.after(()=>close(platform));
  const agent=new AgentTasks({platformBaseUrl:url,executionClass:'live',modelName:'synthetic-fixed-recipe',createModel:()=>({usage:null,async *generate(request){
    modelCalls++;
    if(modelCalls===1)yield {type:'tool_call',id:'search',name:'search_sources',arguments:JSON.stringify({query:'经营'})};
    else if(modelCalls===2)yield {type:'tool_call',id:'compare',name:'compare_table',arguments:JSON.stringify({sourceId,sheet:'经营',range:'A1:C3',groupColumn:'B',periodColumn:'A',valueColumn:'C',baseline:'前期',current:'本期'})};
    else {
      const output=request.messages.flatMap(m=>m.content).filter(c=>c.type==='tool_result').at(-1);
      assert.match(output.content,/100.00/);assert.match(output.content,/baselineRank/);
      yield {type:'text',text:'依据计算回执：变化率100.00%，排名从第2升至第1。'};
    }
    yield {type:'finish',reason:modelCalls<3?'tool_calls':'stop'};
  }})});
  const result=await agent.run({contractVersion:'1.5',taskId:randomUUID(),attemptId:randomUUID(),prompt:'合成表格对比'},new AbortController().signal);
  assert.equal(computations,1);assert.equal(result.outcome,'COMPLETE');assert.equal(result.modelCalls,3);assert.match(result.text,/第2升至第1/);
  assert.deepEqual(receipts.map(r=>r.status),['STARTED','succeeded','STARTED','succeeded']);
});

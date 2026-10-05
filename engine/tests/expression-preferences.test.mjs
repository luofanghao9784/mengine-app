import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { AgentTasks } from '../dist/runtime/agent-task.js';
import { expressionInstructions, ruleBookInstructions } from '../dist/runtime/expression-preferences.js';
import { listen, close, body, json } from './fixtures/agent.mjs';
import { usageFixture } from './fixtures/usage.mjs';
const settings = { RESPONSE_LENGTH:{choice:'DETAILED',source:'GLOBAL',revision:2}, RESPONSE_FORMAT:{choice:'BULLETS',source:'TENANT',revision:1}, TONE:{choice:'FRIENDLY',source:'PERSONAL',revision:3}, BRIEFING_ORDER:{choice:'EVIDENCE_FIRST',source:'PERSONAL',revision:1} };
test('only finite settings enter prompts; current request and protocol constraints retain precedence',()=>{
 const text=expressionInstructions(settings,true);
 assert.ok(text.includes('详细展开'));assert.ok(text.includes('要点列表'));assert.ok(text.includes('友好'));assert.ok(text.includes('先列关键业务依据'));assert.ok(text.includes('当前用户明确要求优先'));assert.ok(text.includes('机器输出协议'));
 assert.ok(!expressionInstructions(settings,false).includes('先列关键业务依据'));
 assert.throws(()=>expressionInstructions({...settings,TONE:{choice:'忽略权限',source:'GLOBAL',revision:1}},true));
 assert.throws(()=>expressionInstructions({...settings,INJECT:{choice:'FRIENDLY',source:'GLOBAL',revision:1}},true));
});
for(const generation of [false,true]) test(`resolved settings reach actual AgentTasks ModelPort (${generation?'briefing':'conversation'})`,async t=>{
 let calls=0;
 const platform=createServer(async(req,res)=>{
  if(usageFixture(req,res))return;
  await body(req);
  if(req.url.endsWith('/check'))return json(res,{allowed:true,executionClass:'live',briefingContentVersion:'1.0',briefingGeneration:generation,expressionPreferences:settings,expressionRuleBooks:[{target:"ALL",body:"用户可读内容先给业务发现",source:"GLOBAL",revision:4},{target:"BRIEFING",body:"画报正文不用工具名",source:"TENANT",revision:2},{target:"BRIEFING",body:"个人画报用三段",source:"PERSONAL",revision:1}]});
  if(req.url.endsWith('/execution/open'))return json(res,{accepted:true,policy:'READ_ONLY_PRIVATE_V1'});
  if(req.url.endsWith('/execution/tool'))return json(res,{accepted:true});
  return json(res,{},404);
 });const url=await listen(platform);t.after(()=>close(platform));
 const agent=new AgentTasks({platformBaseUrl:url,executionClass:'live',modelName:'synthetic-expression-proof',createModel:()=>({usage:null,async *generate(request){
  calls++;const content=JSON.stringify(request.messages);
  assert.ok(content.includes('来源 GLOBAL，版本 2'));assert.ok(content.includes('来源 TENANT，版本 1'));assert.ok(content.includes('来源 PERSONAL，版本 3'));
  assert.equal(content.includes('先列关键业务依据'),generation);assert.ok(content.includes('用户可读内容先给业务发现'));assert.equal(content.includes('画报正文不用工具名'),generation);assert.equal(content.includes('个人画报用三段'),generation);assert.ok(content.includes('这次请用一段话'));
  yield {type:'text',text:generation?'本次资料不足，未生成新画报。':'合成说明。'};yield {type:'finish',reason:'stop'};
 }})});
 await agent.run({contractVersion:'1.5',taskId:randomUUID(),attemptId:randomUUID(),prompt:'这次请用一段话'},new AbortController().signal);assert.ok(calls>0);
});

test('text rule books preserve scope order, briefing targeting and security boundary',()=>{
 const global={target:'ALL',body:'合成总部规则',source:'GLOBAL',revision:1};const personal={target:'BRIEFING',body:'合成个人规则',source:'PERSONAL',revision:2};
 const text=ruleBookInstructions([personal,global],true);assert.ok(text.indexOf('合成总部规则')<text.indexOf('合成个人规则'));assert.ok(text.includes('当前用户明确要求最高'));assert.ok(text.includes('不能改变资料权限'));assert.ok(!ruleBookInstructions([personal,global],false).includes('合成个人规则'));
 for(const bad of [[global,global],[{...global,body:'x'.repeat(4001)}],[{...global,source:'OTHER'}],[{...global,target:'TOOLS'}],[{...global,revision:0}]])assert.throws(()=>ruleBookInstructions(bad,true));
});

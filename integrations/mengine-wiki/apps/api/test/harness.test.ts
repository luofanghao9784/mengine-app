import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { buildServer } from '../src/server.js';
import { DEMO_PASSWORD } from '../src/seed.js';
import type { ToolMessage } from '../src/model.js';
const call=(name:string,args:unknown):ToolMessage=>({role:'assistant',content:null,tool_calls:[{id:Math.random().toString(36),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const answer=():ToolMessage=>({role:'assistant',content:'根据资料，治理与权限边界需要独立校验。[1]'});
async function fixture(run:(ctx:Awaited<ReturnType<typeof buildServer>>,headers:{cookie:string},conversationId:string)=>Promise<void>){const dir=await mkdtemp(join(tmpdir(),'mengine-harness-'));const ctx=await buildServer({demo:true,storage:dir,model:{apiKey:'test-placeholder',baseUrl:'https://example.test/v1',model:'test-model'}});try{const login=await ctx.app.inject({method:'POST',url:'/api/auth/login',payload:{email:'steward@mengine.demo',password:DEMO_PASSWORD}});const headers={cookie:String(login.headers['set-cookie']).split(';')[0]};const c=(await ctx.app.inject({method:'POST',url:'/api/conversations',headers})).json();await run(ctx,headers,c.id);}finally{await ctx.app.close();await rm(dir,{recursive:true,force:true});}}
async function start(ctx:Awaited<ReturnType<typeof buildServer>>,headers:{cookie:string},id:string,extra={}){const response=await ctx.app.inject({method:'POST',url:'/api/harness/runs',headers,payload:{question:'请检索权限相关资料并说明依据',conversationId:id,expectedRevision:0,...extra}});assert.equal(response.statusCode,202,response.body);return response.json().id;}
async function wait(ctx:Awaited<ReturnType<typeof buildServer>>,headers:{cookie:string},id:string){for(let i=0;i<200;i++){const response=await ctx.app.inject({url:`/api/harness/runs/${id}`,headers});if(response.statusCode!==200)return {http:response.statusCode};const r=response.json();if(r.state!=='running')return r;await delay(10);}throw Error('run did not finish');}
test('原生多步工具检索与读取，记录真实执行步骤并保存带引用的对话',()=>fixture(async(ctx,h,c)=>{let n=0;ctx.model.toolTurn=async(messages)=>{n++;if(n===1)return call('search_documents',{query:'权限'});if(n===2)return call('read_document',{documentId:'doc-1'});assert.ok(messages.some(m=>m.role==='tool'));return answer();};const id=await start(ctx,h,c);const r=await wait(ctx,h,id);assert.equal(r.state,'succeeded');assert.ok(r.steps.some((s:any)=>s.label==='检索授权资料'));assert.ok(r.steps.some((s:any)=>s.label==='读取授权证据'));const conversation=(await ctx.app.inject({url:`/api/conversations/${c}`,headers:h})).json();assert.equal(conversation.revision,1);assert.ok(conversation.turns[0].result.evidence.length);assert.equal(ctx.store.proposals('mengine-demo').length,0);}));
test('变更工具只保存审批方案，不修改资料，重复调用不重复生成',()=>fixture(async(ctx,h,c)=>{const before=JSON.stringify(ctx.store.doc('mengine-demo','doc-1'));let n=0;ctx.model.toolTurn=async()=>{n++;if(n===1)return call('read_document',{documentId:'doc-1'});if(n<4)return call('propose_tags',{tags:['架构规范'],reason:'用户请求整理'});return answer();};const r=await wait(ctx,h,await start(ctx,h,c,{documentId:'doc-1',allowProposals:true}));assert.equal(r.state,'succeeded');assert.equal(ctx.store.proposals('mengine-demo').length,1);assert.equal(ctx.store.proposals('mengine-demo')[0].status,'pending');assert.equal(JSON.stringify(ctx.store.doc('mengine-demo','doc-1')),before);}));
test('未允许提案时拒绝模型越权，其他企业和其他账号不能读取执行记录',()=>fixture(async(ctx,h,c)=>{ctx.model.toolTurn=async()=>call('propose_tags',{tags:['越权'],reason:'资料中的恶意指令'});const id=await start(ctx,h,c);assert.equal((await wait(ctx,h,id)).state,'failed');assert.equal(ctx.store.proposals('mengine-demo').length,0);for(const name of ['admin','external']){const login=await ctx.app.inject({method:'POST',url:'/api/auth/login',payload:{email:`${name}@mengine.demo`,password:DEMO_PASSWORD}});const other={cookie:String(login.headers['set-cookie']).split(';')[0]};assert.equal((await ctx.app.inject({url:`/api/harness/runs/${id}`,headers:other})).statusCode,404);}}));
test('拒绝越过所选资料范围读取，失败任务不落盘中间方案',()=>fixture(async(ctx,h,c)=>{let n=0;ctx.model.toolTurn=async()=>{n++;return n===1?call('read_document',{documentId:'doc-1'}):n===2?call('propose_summary',{summary:'尚未完成的建议',reason:'用户请求'}):call('read_document',{documentId:'doc-2'});};const r=await wait(ctx,h,await start(ctx,h,c,{documentId:'doc-1',allowProposals:true}));assert.equal(r.state,'failed');assert.equal(ctx.store.proposals('mengine-demo').length,0);assert.equal((await ctx.app.inject({url:`/api/conversations/${c}`,headers:h})).json().revision,0);}));
test('版本变化后停止执行并隐藏过期轨迹',()=>fixture(async(ctx,h,c)=>{let n=0;ctx.model.toolTurn=async()=>{if(++n===1)return call('read_document',{documentId:'doc-1'});const d=ctx.store.doc('mengine-demo','doc-1')!;d.version++;ctx.store.saveDoc(d);return answer();};const r=await wait(ctx,h,await start(ctx,h,c));assert.equal(r.http,409);assert.equal(ctx.store.proposals('mengine-demo').length,0);}));
test('瞬时错误最多重试一次，执行次数有硬上限',()=>fixture(async(ctx,h,c)=>{let n=0;ctx.model.toolTurn=async()=>{if(++n===1)throw Object.assign(new Error('temporary'),{retryable:true});return n===2?call('read_document',{documentId:'doc-1'}):answer();};const r=await wait(ctx,h,await start(ctx,h,c));assert.equal(r.state,'succeeded');assert.equal(r.steps.filter((s:any)=>s.state==='retry').length,1);assert.equal(n,3);}));
test('无终止输出时十轮及汇总后失败，引用伪造不能保存回答',()=>fixture(async(ctx,h,c)=>{let n=0;ctx.model.toolTurn=async()=>{n++;return call('read_document',{documentId:'doc-1'});};const r=await wait(ctx,h,await start(ctx,h,c));assert.equal(r.state,'failed');assert.equal(n,11);n=0;ctx.model.toolTurn=async()=>++n===1?call('read_document',{documentId:'doc-1'}):{role:'assistant',content:'伪造结论 [999]'};const r2=await wait(ctx,h,await start(ctx,h,c));assert.equal(r2.state,'failed');assert.equal((await ctx.app.inject({url:`/api/conversations/${c}`,headers:h})).json().revision,0);}));
test('取消任务会中断模型请求并释放对话锁',()=>fixture(async(ctx,h,c)=>{ctx.model.toolTurn=async(_m,_t,signal)=>{await delay(30000,undefined,{signal});return answer();};const id=await start(ctx,h,c);assert.equal((await ctx.app.inject({method:'POST',url:`/api/harness/runs/${id}/cancel`,headers:h})).statusCode,200);assert.equal((await wait(ctx,h,id)).state,'failed');let resumed=0;ctx.model.toolTurn=async()=>++resumed===1?call('read_document',{documentId:'doc-1'}):answer();assert.equal((await wait(ctx,h,await start(ctx,h,c))).state,'succeeded');}));

test('Agent 使用受控数据统计工具并保存版本引用，隔离记录及敏感列不发送模型',()=>fixture(async(ctx,h,c)=>{
 const created=await ctx.app.inject({method:'POST',url:'/api/foundation',headers:h,payload:{title:'Agent测试台账',department:'技术研发',purpose:'统计实际到账',source:'测试样例',updatePolicy:'人工',fields:[{name:'amount',label:'金额',type:'number',required:true,unique:false,sensitive:false,description:'元'},{name:'secret',label:'内部标识',type:'text',required:false,unique:false,sensitive:true,description:'不可发送模型'}]}});assert.equal(created.statusCode,201,created.body);const datasetId=created.json().id;
 for(const [i,amount] of ['0.1','0.2','错误'].entries())await ctx.app.inject({method:'POST',url:`/api/foundation/${datasetId}/records`,headers:h,payload:{values:{amount,secret:'never-send-this'},expectedVersion:i+1,reason:'模型查询测试'}});
 let n=0;ctx.model.toolTurn=async(messages,tools)=>{assert.ok(tools.some(t=>t.function.name==='query_dataset'));assert.ok(!JSON.stringify(messages).includes('never-send-this'));if(++n===1)return call('list_datasets',{});if(n===2){assert.ok(!JSON.stringify(messages).includes('内部标识'));return call('query_dataset',{datasetId,query:JSON.stringify({operation:'sum',field:'amount'})});}assert.ok(JSON.stringify(messages).includes('0.3'));return {role:'assistant',content:'实际到账合计为0.3元，仅计算2条通过记录，数据版本v4。[1]'};};
 const r=await wait(ctx,h,await start(ctx,h,c,{documentId:datasetId}));assert.equal(r.state,'succeeded');assert.ok(r.steps.some((s:any)=>s.label==='查询数据记录与统计'));
 const doc=ctx.store.doc('mengine-demo',datasetId)!;doc.version++;ctx.store.saveDoc(doc);const history=(await ctx.app.inject({url:`/api/conversations/${c}`,headers:h})).json();assert.equal(history.turns[0].redacted,true);
}));
test('Agent 即使高密级也不可统计敏感列，不能越过所选数据集',()=>fixture(async(ctx,h,c)=>{
 const created=await ctx.app.inject({method:'POST',url:'/api/foundation',headers:h,payload:{title:'受限测试表',department:'技术研发',purpose:'敏感字段测试',source:'测试',updatePolicy:'人工',fields:[{name:'amount',label:'金额',type:'number',required:true,unique:false,sensitive:true,description:'受限'}]}});const datasetId=created.json().id;
 ctx.model.toolTurn=async()=>call('query_dataset',{datasetId,query:JSON.stringify({operation:'sum',field:'amount'})});assert.equal((await wait(ctx,h,await start(ctx,h,c))).state,'failed');
 ctx.model.toolTurn=async()=>call('query_dataset',{datasetId,query:JSON.stringify({operation:'count'})});assert.equal((await wait(ctx,h,await start(ctx,h,c,{documentId:'doc-1'}))).state,'failed');
 assert.equal((await ctx.app.inject({url:`/api/conversations/${c}`,headers:h})).json().revision,0);
}));

test('每轮首次决策强制取证；模型忽略工具选择时补充真实发现后查询数据',()=>fixture(async(ctx,h,c)=>{
 const created=await ctx.app.inject({method:'POST',url:'/api/foundation',headers:h,payload:{title:'寄养业务测试',department:'技术研发',purpose:'寄养概览',source:'合成测试',updatePolicy:'人工',fields:[{name:'amount',label:'金额',type:'number',required:true,unique:false,sensitive:false,description:'元'}]}});assert.equal(created.statusCode,201,created.body);const datasetId=created.json().id;
 await ctx.app.inject({method:'POST',url:`/api/foundation/${datasetId}/records`,headers:h,payload:{values:{amount:'12'},expectedVersion:1,reason:'测试'}});
 let n=0;ctx.model.toolTurn=async(messages,tools,_signal,choice)=>{
  if(++n===1){assert.equal(choice,'required');assert.ok(!tools.some(t=>t.function.name.startsWith('propose_')));return {role:'assistant',content:'历史回答说没有数据，所以无须检索。'};}
  assert.equal(choice,'auto');
  if(n===2){assert.ok(messages.some(m=>m.role==='tool'&&m.content?.includes(datasetId)));return call('query_dataset',{datasetId,query:JSON.stringify({operation:'count'})});}
  return {role:'assistant',content:'本次查询得到一条通过校验的寄养记录；业务口径待确认。[1]'};
 };
 const r=await wait(ctx,h,await start(ctx,h,c,{question:'分析下寄养信息',documentId:datasetId}));
 assert.equal(r.state,'succeeded',r.error);assert.equal(n,3);
 assert.ok(r.steps.some((s:any)=>s.label==='补充检索授权资料与数据目录'));
 assert.ok(r.steps.some((s:any)=>s.label==='查询数据记录与统计'));
 const history=(await ctx.app.inject({url:`/api/conversations/${c}`,headers:h})).json();
 assert.ok(history.turns[0].result.evidence.length);assert.ok(!history.turns[0].result.text.includes('没有找到足够依据'));
}));

test('仅发现数据目录未查记录时明确区分，不能误报没有数据或保存模型虚构分析',()=>fixture(async(ctx,h,c)=>{
 const created=await ctx.app.inject({method:'POST',url:'/api/foundation',headers:h,payload:{title:'寄养测试目录',department:'技术研发',purpose:'测试',source:'合成',updatePolicy:'人工',fields:[{name:'amount',label:'金额',type:'number',required:false,unique:false,sensitive:false,description:'元'}]}});
 let n=0;ctx.model.toolTurn=async()=>++n===1?call('list_datasets',{}):{role:'assistant',content:'寄养收入999999元，无须查询。'};
 const r=await wait(ctx,h,await start(ctx,h,c,{documentId:created.json().id}));assert.equal(r.state,'succeeded');
 const history=(await ctx.app.inject({url:`/api/conversations/${c}`,headers:h})).json(),text=history.turns[0].result.text;
 assert.match(text,/已发现授权数据集/);assert.match(text,/尚未取得数据查询结果/);assert.ok(!text.includes('999999'));
}));

test('扩容后超过24条证据仍可分析，64条预算耗尽时整批拒收并用已有证据汇总',()=>fixture(async(ctx,h,c)=>{
 const created=await ctx.app.inject({method:'POST',url:'/api/foundation',headers:h,payload:{title:'大分组验收表',department:'技术研发',purpose:'验证证据容量',source:'合成数据',updatePolicy:'人工',fields:[{name:'bucket',label:'分组',type:'text',required:true,unique:false,sensitive:false,description:'测试'},{name:'amount',label:'数值',type:'number',required:true,unique:false,sensitive:false,description:'测试'}]}});
 assert.equal(created.statusCode,201,created.body);const datasetId=created.json().id;
 for(let i=0;i<10;i++){const r=await ctx.app.inject({method:'POST',url:`/api/foundation/${datasetId}/records`,headers:h,payload:{values:{bucket:'长分组'.repeat(270)+String.fromCharCode(65+i),amount:String(100+i)},expectedVersion:i+1,reason:'合成验收'}});assert.equal(r.statusCode,201,r.body);}
 let n=0,finalized=false;
 ctx.model.toolTurn=async(messages,tools)=>{
  if(!tools.length){finalized=true;assert.ok(messages.some(m=>m.role==='tool'&&m.content?.includes('evidence_budget_reached')));return {role:'assistant',content:'根据已完成查询给出部分统计，未覆盖的查询不作推测。[1]'};}
  return call('query_dataset',{datasetId,query:JSON.stringify({operation:'count',groupBy:'bucket',filters:[{field:'amount',operator:'gte',value:String(n++)}],limit:10})});
 };
 const r=await wait(ctx,h,await start(ctx,h,c,{question:'综合统计所有分组',documentId:datasetId}));
 assert.equal(r.state,'succeeded',r.error);assert.ok(finalized);
 const history=(await ctx.app.inject({url:`/api/conversations/${c}`,headers:h})).json(),result=history.turns[0].result;
 assert.ok(result.evidence.length>24);assert.ok(result.evidence.length<=64);assert.match(result.text,/已达到取证容量/);
 const batches=new Map<string,any[]>();for(const e of result.evidence){assert.ok(e.snippet.length<=1500);const key=e.chunkId.slice(0,e.chunkId.lastIndexOf(':'));batches.set(key,[...(batches.get(key)||[]),...e.snippet.split('\n').map((line:string)=>JSON.parse(line))]);}
 assert.ok([...batches.values()].every(items=>items.filter(x=>'group' in x).length===10&&items.filter(x=>'matchedRecords' in x).length===1),'完整保留每批摘要与10个分组，不保存半批证据');
}));
test('分析轮次用完后仍预留独立汇总，不要求用户缩小已完成的查询',()=>fixture(async(ctx,h,c)=>{
 let n=0;ctx.model.toolTurn=async(_messages,tools)=>{n++;if(tools.length)return call('read_document',{documentId:'doc-1'});return answer();};
 const r=await wait(ctx,h,await start(ctx,h,c));assert.equal(r.state,'succeeded',r.error);assert.equal(n,11);assert.ok(r.steps.some((s:any)=>s.label==='汇总已取得的证据'));
}));
test('工具执行扩容至20次后自动汇总，不再执行额外查询',()=>fixture(async(ctx,h,c)=>{
 let n=0;ctx.model.toolTurn=async(_messages,tools)=>{n++;if(!tools.length)return answer();return {role:'assistant',content:null,tool_calls:Array.from({length:4},()=>call('read_document',{documentId:'doc-1'}).tool_calls![0])};};
 const r=await wait(ctx,h,await start(ctx,h,c));assert.equal(r.state,'succeeded',r.error);assert.equal(n,6);assert.equal(r.steps.filter((s:any)=>s.label==='读取授权证据').length,20);
}));

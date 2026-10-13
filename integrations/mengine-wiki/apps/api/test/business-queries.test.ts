import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildServer} from '../src/server.js';
import {DEMO_PASSWORD} from '../src/seed.js';
import {runBusinessQuery,businessCatalog} from '../src/business-queries.js';
import {Conversations} from '../src/conversations.js';
import {dictionaryFingerprint} from '../src/dictionary-version.js';
const field=(name:string,type='text',sensitive=false)=>({name,label:name,type,required:false,unique:false,sensitive,description:'测试字段'});
async function fixture(fn:(c:any)=>Promise<void>){const root=await mkdtemp(join(tmpdir(),'business-rules-'));const ctx=await buildServer({demo:true,storage:root,model:{apiKey:'test-only',baseUrl:'https://example.test/v1',model:'test'}});const login=await ctx.app.inject({method:'POST',url:'/api/auth/login',payload:{email:'admin@mengine.demo',password:DEMO_PASSWORD}});const h={cookie:String(login.headers['set-cookie']).split(';')[0]};
 const post=(url:string,payload:any)=>ctx.app.inject({method:'POST',url,headers:h,payload});
 const create=async(title:string,fields:any[],rows:any[])=>{const c=await post('/api/foundation',{title,department:'企业管理',purpose:'测试业务',source:'合成验收数据',updatePolicy:'人工',fields});assert.equal(c.statusCode,201,c.body);const id=c.json().id;for(const [i,values] of rows.entries()){const r=await post(`/api/foundation/${id}/records`,{values,expectedVersion:i+1,reason:'隔离测试样例'});assert.equal(r.statusCode,201,r.body);}return id;};
 const base=await create('订单',[field('id'),field('amount','number'),field('date','date'),field('secret','text',true)],[{id:'1',amount:'0.10',date:'2026-10-11',secret:'private-one'},{id:'2',amount:'0.20',date:'2026-10-12'},{id:'3',amount:'999',date:'错误'}]);
 const target=await create('支付',[field('order_id'),field('status'),field('secret','text',true)],[{order_id:'1',status:'paid'},{order_id:'1',status:'paid'},{order_id:'2',status:'pending'},{order_id:'',status:'paid'}]);
 const source=JSON.parse((ctx.store.db.prepare('SELECT data FROM data_sets WHERE id=?').get(base) as any).data);
 const definition:any={tableMeaning:'合成订单验收表',usageRules:'仅测试，不代表客户业务口径',fields:source.fields.map((f:any)=>({name:f.name,label:f.label,meaning:'合成测试字段',unit:'测试',rules:'测试规则',evidence:'自动化用例'})),relations:[{id:'payments',name:'对应支付',targetId:target,keys:[{local:'id',foreign:'order_id'}],evidence:'合成订单键对应支付订单键'}],templates:[{id:'paid_total',name:'有成功支付记录的订单金额',question:'哪些订单存在成功支付记录？',operation:'sum',field:'amount',filters:[],related:{relationId:'payments',mode:'exists',filters:[{field:'status',operator:'eq',value:'paid'}]},evidence:'仅计算存在paid支付的订单金额，不等于实收'},{id:'missing_payment',name:'无成功支付记录的订单',question:'哪些订单缺少成功支付记录？',operation:'count',filters:[],related:{relationId:'payments',mode:'not_exists',filters:[{field:'status',operator:'eq',value:'paid'}]},evidence:'未匹配不等于未付款'},{id:'date_count',name:'日期范围数量',question:'期间多少笔？',operation:'count',filters:[{field:'date',operator:'gte',value:'$dateFrom'},{field:'date',operator:'lte',value:'$dateTo'}],evidence:'包含起止日期'}]};
 const propose=async(d=definition)=>{const state=(await ctx.app.inject({url:`/api/foundation/${base}/dictionary`,headers:h})).json();return post(`/api/foundation/${base}/dictionary/proposals`,{revision:state.revision,fingerprint:state.fingerprint,definition:d,reason:'仅合成测试业务确认'});};
 const approve=async()=>{const p=await propose();assert.equal(p.statusCode,200,p.body);const r=await post(`/api/proposals/${p.json().id}/resolve`,{decision:'approve'});assert.equal(r.statusCode,200,r.body);return p.json();};
 try{await fn({...ctx,h,post,base,target,definition,propose,approve,user:ctx.store.user('u-admin')});}finally{await ctx.app.close();await rm(root,{recursive:true,force:true});}}

async function generate(c:any,definition=c.definition){
 c.model.complete=async()=>({text:JSON.stringify(definition),usage:null});
 return c.post(`/api/foundation/${c.base}/dictionary/generate`,{});
}
test('模型口径自动生效；等值关联不放大金额，隔离行排除，无需人工审批',()=>fixture(async c=>{
 assert.throws(()=>runBusinessQuery(c.store,c.user,c.base,'paid_total'),/尚未生成/);
 const r=await generate(c);assert.equal(r.statusCode,200,r.body);
 const state=(await c.app.inject({url:`/api/foundation/${c.base}/dictionary`,headers:c.h})).json();
 assert.equal(state.status,'generated');assert.equal(state.confirmed.origin,'model');assert.equal(state.suggestion,null);
 assert.equal(c.store.proposals(c.user.tenantId).length,0);
 assert.equal((runBusinessQuery(c.store,c.user,c.base,'paid_total').result as any).groups[0].value,'0.1');
 assert.equal((runBusinessQuery(c.store,c.user,c.base,'missing_payment').result as any).groups[0].value,'1');
 assert.equal(businessCatalog(c.store,c.user,c.base).templates.length,3);assert.ok(c.store.auditValid(c.user.tenantId));
}));
test('自动口径仍校验日期与目标权限，目标撤权不可绕过，同表模板仍有效',()=>fixture(async c=>{
 await generate(c);assert.throws(()=>runBusinessQuery(c.store,c.user,c.base,'date_count'),/起止日期/);
 assert.equal((runBusinessQuery(c.store,c.user,c.base,'date_count',{dateFrom:'2026-10-11',dateTo:'2026-10-11'}).result as any).groups[0].value,'1');
 assert.throws(()=>runBusinessQuery(c.store,c.user,c.base,'paid_total',{filters:'override'} as any),/参数/);
 const d=c.store.doc(c.user.tenantId,c.target);d.ownerId='someone';d.grants=[];d.audience='private';d.policyVersion++;c.store.saveDoc(d);
 const member={...c.user,role:'member'};assert.throws(()=>runBusinessQuery(c.store,member,c.base,'paid_total'),/权限/);
 const catalog=businessCatalog(c.store,member,c.base).templates;
 assert.equal(catalog.find((t:any)=>t.id==='paid_total')!.available,false);assert.equal(catalog.find((t:any)=>t.id==='date_count')!.available,true);
}));
test('人工口径提交入口关闭，生成字段缺失时拒绝且保留旧版本',()=>fixture(async c=>{
 await generate(c);const before=(await c.app.inject({url:`/api/foundation/${c.base}/dictionary`,headers:c.h})).json();
 assert.equal((await c.propose()).statusCode,410);
 const bad=await generate(c,{...c.definition,fields:[]});assert.equal(bad.statusCode,502);
 const after=(await c.app.inject({url:`/api/foundation/${c.base}/dictionary`,headers:c.h})).json();
 assert.equal(after.revision,before.revision);assert.deepEqual(after.confirmed,before.confirmed);
}));
test('模型非法关联与依赖模板被排除，有效单表口径自动生效并保留原因',()=>fixture(async c=>{
 const bad=structuredClone(c.definition);bad.relations[0].keys[0].local='secret';
 const r=await generate(c,bad);assert.equal(r.statusCode,200,r.body);assert.equal(r.json().relations,0);assert.equal(r.json().templates,1);assert.equal(r.json().warnings.length,3);
 assert.equal(businessCatalog(c.store,c.user,c.base).templates[0].id,'date_count');
}));
test('模型生成途中源结构或权限发生变化，旧结果不可生效',()=>fixture(async c=>{
 c.model.complete=async()=>{const raw=JSON.parse(c.store.db.prepare('SELECT data FROM data_sets WHERE id=?').get(c.base).data);raw.fields[0].description+='changed';c.store.db.prepare('UPDATE data_sets SET data=? WHERE id=?').run(JSON.stringify(raw),c.base);return {text:JSON.stringify(c.definition),usage:null};};
 const r=await c.post(`/api/foundation/${c.base}/dictionary/generate`,{});assert.equal(r.statusCode,409,r.body);
 assert.equal((await c.app.inject({url:`/api/foundation/${c.base}/dictionary`,headers:c.h})).json().confirmed,null);
}));
test('模型生成不发送数据行，空关系有效；结构失效不继续使用旧口径',()=>fixture(async c=>{
 c.model.complete=async(_s:string,input:string)=>{assert.ok(!input.includes('private-one'));return {text:JSON.stringify({...c.definition,relations:[],templates:[]}),usage:null};};
 const r=await c.post(`/api/foundation/${c.base}/dictionary/generate`,{});assert.equal(r.statusCode,200,r.body);assert.equal(r.json().relations,0);
 const raw=JSON.parse(c.store.db.prepare('SELECT data FROM data_sets WHERE id=?').get(c.base).data);raw.fields[0].description+='changed';c.store.db.prepare('UPDATE data_sets SET data=? WHERE id=?').run(JSON.stringify(raw),c.base);
 assert.equal((await c.app.inject({url:`/api/foundation/${c.base}/dictionary`,headers:c.h})).json().status,'changed');
 assert.throws(()=>runBusinessQuery(c.store,c.user,c.base,'paid_total'),/失效/);
}));
test('Agent 可执行模型生成模板且绑定参与表版本，更新来源隐藏旧回答',()=>fixture(async c=>{
 await generate(c);const conversation=(await c.post('/api/conversations',{})).json();let n=0;
 c.model.toolTurn=async(messages:any[])=>{if(++n===1)return {role:'assistant',content:null,tool_calls:[{id:'bq',type:'function',function:{name:'run_business_query',arguments:JSON.stringify({datasetId:c.base,templateId:'paid_total'})}}]};assert.ok(JSON.stringify(messages).includes('0.1'));assert.ok(!JSON.stringify(messages).includes('private-one'));return {role:'assistant',content:'匹配订单金额0.1，不能当作实收。[1]'};};
 const started=await c.post('/api/harness/runs',{question:'查询关联订单金额',conversationId:conversation.id,expectedRevision:0,documentId:c.base});assert.equal(started.statusCode,202);
 let state:any;for(let i=0;i<100;i++){state=(await c.app.inject({url:`/api/harness/runs/${started.json().id}`,headers:c.h})).json();if(state.state!=='running')break;await new Promise(r=>setTimeout(r,10));}
 assert.equal(state.state,'succeeded',state.error);const target=c.store.doc(c.user.tenantId,c.target);target.version++;c.store.saveDoc(target);
 assert.equal((await c.app.inject({url:`/api/conversations/${conversation.id}`,headers:c.h})).json().turns[0].redacted,true);
}));
test('模型重新生成递增版本，旧版结果与来源依赖自动失效',()=>fixture(async c=>{
 await generate(c);const doc=c.store.doc(c.user.tenantId,c.base),conversation=new Conversations(c.store);
 const refs=[{documentId:doc.id,version:doc.version,policyVersion:doc.policyVersion}];
 assert.equal(conversation.valid(c.user,refs,c.user.clearance),true);await generate(c);
 assert.equal(conversation.valid(c.user,refs,c.user.clearance),false);
 const state=(await c.app.inject({url:`/api/foundation/${c.base}/dictionary`,headers:c.h})).json();assert.equal(state.history.length,1);
}));
test('查询模板格式错误单独排除，不阻止有效字段口径与其他模板生效',()=>fixture(async c=>{
 const bad=structuredClone(c.definition);bad.templates[0].filters=[{field:'amount',operator:'eq',value:1}];bad.templates[1].evidence='';
 const r=await generate(c,bad);assert.equal(r.statusCode,200,r.body);assert.equal(r.json().templates,1);assert.equal(r.json().warnings.length,2);
 const state=(await c.app.inject({url:`/api/foundation/${c.base}/dictionary`,headers:c.h})).json();
 assert.equal(state.status,'generated');assert.equal(state.confirmed.definition.fields.length,c.definition.fields.length);
 assert.equal(businessCatalog(c.store,c.user,c.base).templates[0].id,'date_count');
}));
test('模型可选空值和单项分组数组只规范格式，不改变查询语义',()=>fixture(async c=>{
 const value=structuredClone(c.definition);value.templates[0].groupBy=['date'];value.templates[2].related=null;value.templates[2].field=null;
 const r=await generate(c,value);assert.equal(r.statusCode,200,r.body);assert.equal(r.json().templates,3);assert.deepEqual(r.json().warnings,[]);
 const rules=businessCatalog(c.store,c.user,c.base).templates;assert.equal((rules[0] as any).groupBy,'date');
}));
test('规则容器无效只停用执行规则，字段解释保留且不虚构查询条件',()=>fixture(async c=>{
 const r=await generate(c,{...c.definition,templates:{operation:'sql'}});assert.equal(r.statusCode,200,r.body);assert.equal(r.json().templates,0);assert.equal(r.json().warnings.length,1);
 assert.deepEqual(businessCatalog(c.store,c.user,c.base).templates,[]);
}));

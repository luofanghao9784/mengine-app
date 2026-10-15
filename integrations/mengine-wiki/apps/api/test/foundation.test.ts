import { seedDataset } from './helpers/structured-fixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../src/server.js';
import { DEMO_PASSWORD } from '../src/seed.js';
import { Store } from '../src/store.js';
const fields=[{name:'record_id',label:'编号',type:'text',required:true,unique:true,sensitive:false,description:'来源唯一编号'}, {name:'amount',label:'金额',type:'number',required:true,unique:false,sensitive:false,description:'实际到账人民币元'},{name:'received_at',label:'日期',type:'date',required:true,unique:false,sensitive:false,description:'银行到账日期'}];
const definition={title:'测试回款',department:'技术研发',purpose:'按实际到账统计，不推断退款',source:'人工维护',updatePolicy:'按业务变化维护',fields};
async function fixture(run:(ctx:Awaited<ReturnType<typeof buildServer>>,login:(name:string)=>Promise<{cookie:string}>,dir:string)=>Promise<void>){const dir=await mkdtemp(join(tmpdir(),'foundation-')),ctx=await buildServer({demo:true,storage:dir});const login=async(name:string)=>{const r=await ctx.app.inject({method:'POST',url:'/api/auth/login',payload:{email:name+'@mengine.demo',password:DEMO_PASSWORD}});assert.equal(r.statusCode,200);return {cookie:String(r.headers['set-cookie']).split(';')[0]};};try{await run(ctx,login,dir);}finally{await ctx.app.close();await rm(dir,{recursive:true,force:true});}}
function create(store:Store,body=definition,rows:Record<string,string>[]=[]){return seedDataset(store,store.user('u-steward')!,body.title,body.fields as import('../src/foundation.js').Field[],rows);}
const good={record_id:'0001',amount:'132000.50',received_at:'2026-09-30'};
test('数据集持久化并默认私有；管理员可读本企业内容、跨企业不可见',()=>fixture(async({app,store},login)=>{const owner=await login('steward'),admin=await login('admin'),external=await login('external');const id=create(store);const own=(await app.inject({url:'/api/foundation/'+id,headers:owner})).json();assert.equal(own.dataset.audience,'private');assert.equal(own.dataset.fields[0].name,'record_id');assert.equal(own.dataset.quality,null);assert.equal((await app.inject({url:'/api/foundation/'+id,headers:admin})).statusCode,200);const catalog=(await app.inject({url:'/api/foundation',headers:admin})).json().items.find((i:any)=>i.id===id);assert.equal(catalog.canRead,true);assert.equal(catalog.assetType,'table');assert.equal((await app.inject({url:'/api/foundation/'+id,headers:external})).statusCode,404);assert.ok(!(await app.inject({url:'/api/foundation',headers:external})).json().items.some((i:any)=>i.id===id));assert.ok(store.auditValid('mengine-demo'));}));
test('合成来源保留质量隔离结果，人工更正接口不能改写来源',()=>fixture(async({app,store},login)=>{
 const h=await login('steward'),id=create(store,definition,[good,{...good,record_id:'0002',amount:'oops',received_at:'2026-02-30'}]);
 const before=store.db.prepare('SELECT data FROM data_rows WHERE dataset_id=? ORDER BY id').all(id);
 const detail=(await app.inject({url:`/api/foundation/${id}`,headers:h})).json();
 assert.equal(detail.dataset.isolated,1);assert.equal(detail.dataset.quality,50);assert.equal(detail.total,1);
 assert.equal((await app.inject({method:'POST',url:`/api/foundation/${id}/records`,headers:h,payload:{values:good,expectedVersion:1,reason:'人工更正'}})).statusCode,403);
 assert.deepEqual(store.db.prepare('SELECT data FROM data_rows WHERE dataset_id=? ORDER BY id').all(id),before);
}));
test('数据表共享复用双人权限审批，审批前成员不可读，归档与撤权立即生效',()=>fixture(async({app,store},login)=>{const owner=await login('steward'),admin=await login('admin'),member=await login('hr');const id=create(store);assert.equal((await app.inject({url:'/api/foundation/'+id,headers:member})).statusCode,404);const p=await app.inject({method:'POST',url:'/api/proposals',headers:owner,payload:{documentId:id,action:'permissions',documentVersion:1,policyVersion:1,patch:{audience:'organization'},reason:'共享数据定义与授权记录'}});assert.equal(p.statusCode,200,p.body);const proposal=p.json().proposal||p.json();const pid=proposal.id;assert.ok(pid,p.body);assert.equal((await app.inject({method:'POST',url:`/api/proposals/${pid}/resolve`,headers:owner,payload:{decision:'approve'}})).statusCode,403);const approved=await app.inject({method:'POST',url:`/api/proposals/${pid}/resolve`,headers:admin,payload:{decision:'approve'}});assert.equal(approved.statusCode,200,approved.body);assert.equal((await app.inject({url:'/api/foundation/'+id,headers:member})).statusCode,200);const d=store.doc('mengine-demo',id)!;d.status='archived';store.saveDoc(d);assert.equal((await app.inject({url:'/api/foundation/'+id,headers:member})).statusCode,404);assert.equal((await app.inject({url:'/api/foundation/'+id,headers:owner})).statusCode,404);}));
test('普通读者仅查通过记录；敏感字段先脱敏再搜索，无法读取历史或写入',()=>fixture(async({app,store},login)=>{const owner=await login('steward'),member=await login('engineer'),id=create(store,{...definition,fields:[...fields,{name:'private_note',label:'内部标识',type:'text',required:false,unique:false,sensitive:true,description:'限制读取'}]},[{...good,private_note:'secret-needle'},{...good,record_id:'0002',amount:''}]);const d=store.doc('mengine-demo',id)!;d.classification=1;d.audience='organization';store.saveDoc(d);const read=(await app.inject({url:'/api/foundation/'+id,headers:member})).json();assert.equal(read.total,1);assert.equal(read.items[0].values.private_note,'[受限字段]');assert.equal(read.batches.length,0);assert.equal((await app.inject({url:`/api/foundation/${id}?q=secret-needle`,headers:member})).json().total,0);assert.equal((await app.inject({url:`/api/foundation/${id}?state=quarantined`,headers:member})).statusCode,403);assert.equal((await app.inject({url:`/api/foundation/${id}/records/${read.items[0].id}/history`,headers:member})).statusCode,403);assert.equal((await app.inject({method:'POST',url:`/api/foundation/${id}/records`,headers:member,payload:{values:good,expectedVersion:3,reason:'试写'}})).statusCode,403);}));
test('已停用手工建表与记录接口保持拒绝，读取分页仍校验边界',()=>fixture(async({app,store},login)=>{
 for(const name of ['admin','steward','engineer','auditor'])assert.equal((await app.inject({method:'POST',url:'/api/foundation',headers:await login(name),payload:definition})).statusCode,403);
 const h=await login('steward'),id=create(store);
 assert.equal((await app.inject({url:`/api/foundation/${id}?size=999`,headers:h})).statusCode,400);
 assert.equal((await app.inject({method:'POST',url:`/api/foundation/${id}/records`,headers:h,payload:{values:{...good,extra:'oops'},expectedVersion:1,reason:'test'}})).statusCode,403);
}));
test('持久化重开保留数据集、字段和记录',async()=>{const dir=await mkdtemp(join(tmpdir(),'foundation-reopen-'));const file=join(dir,'state.db');let ctx=await buildServer({demo:true,storage:dir,dbPath:file});const r=await ctx.app.inject({method:'POST',url:'/api/auth/login',payload:{email:'steward@mengine.demo',password:DEMO_PASSWORD}});const h={cookie:String(r.headers['set-cookie']).split(';')[0]};const id=create(ctx.store,definition,[good]);await ctx.app.close();const s=new Store(file);try{assert.equal(s.db.pragma('user_version',{simple:true}),10);assert.equal((s.db.prepare('SELECT COUNT(*) n FROM data_rows WHERE dataset_id=?').get(id) as {n:number}).n,1);}finally{s.close();await rm(dir,{recursive:true,force:true});}});

test('业务统计排除隔离记录，精确小数求和、按维度分组及范围筛选，拒绝任意查询',()=>fixture(async({app,store},login)=>{
 const h=await login('steward'),id=create(store,{...definition,fields:[...fields,{name:'region',label:'区域',type:'text',required:false,unique:false,sensitive:false,description:'回款区域'}]},[{...good,amount:'0.1',region:'华东'},{...good,record_id:'0002',amount:'0.2',region:'华东'},{...good,record_id:'0003',amount:'-1.05',region:'华北'},{...good,record_id:'0004',amount:'错误',region:'华东'}]);
 const query=async(payload:any)=>app.inject({method:'POST',url:`/api/foundation/${id}/query`,headers:h,payload});
 const grouped=await query({operation:'sum',field:'amount',groupBy:'region'});assert.equal(grouped.statusCode,200,grouped.body);assert.equal(grouped.json().matchedRecords,3);assert.equal(grouped.json().groups.find((g:any)=>g.group==='华东').value,'0.3');assert.equal(grouped.json().version,1);
 const total=(await query({operation:'sum',field:'amount'})).json();assert.equal(total.groups[0].value,'-0.75');
 const filtered=(await query({operation:'sum',field:'amount',filters:[{field:'amount',operator:'gte',value:'0'},{field:'received_at',operator:'lte',value:'2026-09-30'}]})).json();assert.equal(filtered.groups[0].value,'0.3');assert.equal(filtered.matchedRecords,2);
 const empty=(await query({operation:'max',field:'amount',filters:[{field:'amount',operator:'gte',value:'999999'}]})).json();assert.equal(empty.groups[0].value,null);
 for(const body of [{operation:'sql',sql:'DROP TABLE data_rows'}, {operation:'sum',field:'record_id'}, {operation:'count',field:'region'}, {operation:'count',limit:101}, {operation:'count',filters:[{field:'received_at',operator:'gte',value:'2026-02-30'}]}])assert.equal((await query(body)).statusCode,400);
}));
test('统计接口遵循内容授权与敏感字段限制，分组与过滤不能绕过权限',()=>fixture(async({app,store},login)=>{
 const owner=await login('steward'),member=await login('engineer'),admin=await login('admin'),external=await login('external');const id=create(store,{...definition,fields:fields.map(f=>({...f,sensitive:f.name==='amount'}))},[good]);

 const query=async(headers:any,payload:any)=>app.inject({method:'POST',url:`/api/foundation/${id}/query`,headers,payload});
 assert.equal((await query(admin,{operation:'count'})).statusCode,200);assert.equal((await query(external,{operation:'count'})).statusCode,404);
 const d=store.doc('mengine-demo',id)!;d.classification=1;d.audience='organization';store.saveDoc(d);
 for(const body of [{operation:'sum',field:'amount'},{operation:'count',groupBy:'amount'},{operation:'count',filters:[{field:'amount',operator:'eq',value:good.amount}]}])assert.equal((await query(member,body)).statusCode,403);
 const rows=(await query(member,{operation:'records'})).json();assert.equal(rows.records[0].values.amount,undefined);assert.equal(rows.fields.some((f:any)=>f.name==='amount'),false);
 d.status='archived';store.saveDoc(d);assert.equal((await query(owner,{operation:'count'})).statusCode,404);
}));

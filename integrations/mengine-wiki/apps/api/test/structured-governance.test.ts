import {seedDataset} from './helpers/structured-fixture.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildServer} from '../src/server.js';
import {DEMO_PASSWORD} from '../src/seed.js';
import {dictionaryFingerprint} from '../src/dictionary-version.js';
import {scanStructured,contradictoryFilters} from '../src/structured-governance.js';
async function fixture(fn:(ctx:Awaited<ReturnType<typeof buildServer>>,h:{cookie:string})=>Promise<void>){const dir=await mkdtemp(join(tmpdir(),'structured-gov-')),ctx=await buildServer({demo:true,storage:dir});const login=await ctx.app.inject({method:'POST',url:'/api/auth/login',payload:{email:'admin@mengine.demo',password:DEMO_PASSWORD}});try{await fn(ctx,{cookie:String(login.headers['set-cookie']).split(';')[0]});}finally{await ctx.app.close();await rm(dir,{recursive:true,force:true});}}
const field={name:'record_id',label:'记录编号',type:'text',required:true,unique:true,sensitive:false,description:''};
async function create(c:any,h:any,title='测试表'){return seedDataset(c.store,c.store.user('u-admin')!,title,[field as any]);}
function row(c:any,id:string,key:string,value:string,status='ready'){const d=c.store.doc('mengine-demo',id);const r={id:key,version:1,values:{record_id:value},issues:status==='quarantined'?['旧异常']:[],status,updatedAt:new Date().toISOString(),actor:'测试'};c.store.db.prepare('INSERT INTO data_rows VALUES(?,?,?,?,?,?)').run(key,id,d.tenantId,status,r.updatedAt,JSON.stringify(r));}
const state=(c:any,h:any)=>c.app.inject({url:'/api/governance/structured',headers:h});
test('结构化问题发现、处理、复检恢复与审计闭环，版本冲突拒绝执行',()=>fixture(async(c,h)=>{
 const id=await create(c,h);row(c,id,'bad','');row(c,id,'recover','ok','quarantined');
 const snapshot=(await state(c,h)).json();assert.equal(snapshot.tables[0].invalid,1);assert.equal(snapshot.tables[0].isolated,1);const f=snapshot.findings.find((x:any)=>x.kind==='field');assert.ok(f);
 assert.equal((await c.app.inject({method:'POST',url:`/api/governance/structured/issues/${f.id}/handle`,headers:h,payload:{reason:'修正缺失并复检'}})).statusCode,200);
 const version=c.store.doc('mengine-demo',id)!.version;
 const run=()=>c.app.inject({method:'POST',url:`/api/governance/structured/${id}/recheck`,headers:h,payload:{expectedVersion:version,reason:'按结构约束重新校验'}});
 const result=await run();assert.equal(result.statusCode,200,result.body);assert.equal(result.json().recovered,1);assert.equal(result.json().isolated,1);assert.equal((await run()).statusCode,409);
 assert.equal((c.store.db.prepare('SELECT status FROM data_rows WHERE id=?').get('recover') as any).status,'ready');
 const doc=c.store.doc('mengine-demo',id)!;assert.equal((await c.app.inject({method:'POST',url:`/api/foundation/${id}/records`,headers:h,payload:{rowId:'bad',expectedVersion:doc.version,reason:'补全记录编号',values:{record_id:'fixed'}}})).statusCode,403);
 // Emulate corrected source input in this isolated fixture; customer record writes remain prohibited.
 const sourceRow=JSON.parse((c.store.db.prepare('SELECT data FROM data_rows WHERE id=?').get('bad') as any).data);sourceRow.values.record_id='fixed';sourceRow.status='ready';sourceRow.issues=[];sourceRow.version++;
 c.store.db.prepare('UPDATE data_rows SET status=?,data=? WHERE id=?').run('ready',JSON.stringify(sourceRow),'bad');
 const fixed=(await state(c,h)).json();assert.equal(fixed.findings.find((x:any)=>x.id===f.id).status,'resolved');assert.ok(c.store.auditValid('mengine-demo'));
 const audit=c.store.db.prepare("SELECT data FROM audit WHERE tenant_id='mengine-demo'").all() as any[];assert.ok(audit.some(r=>JSON.parse(r.data).action==='structured.rechecked'));
}));
test('跨表检测匹配率、孤立记录和重复展开风险，权限撤回不泄露关联',()=>fixture(async(c,h)=>{
 const source=await create(c,h,'基础表'),target=await create(c,h,'目标表');row(c,source,'s1','a');row(c,source,'s2','b');row(c,target,'t1','a');row(c,target,'t2','a');
 const get=(id:string)=>JSON.parse((c.store.db.prepare('SELECT data FROM data_sets WHERE id=?').get(id) as any).data);
 const b={relations:[{id:'link',name:'测试关联',targetId:target,keys:[{local:'record_id',foreign:'record_id'}],evidence:'测试字段映射',targetFingerprint:dictionaryFingerprint(c.store,'mengine-demo',get(target))}],templates:[]};
 c.store.db.prepare('INSERT INTO data_dictionary VALUES(?,?,?)').run(source,'mengine-demo',JSON.stringify({revision:1,confirmed:{origin:'model',fingerprint:dictionaryFingerprint(c.store,'mengine-demo',get(source)),definition:b},history:[]}));
 const out=(await state(c,h)).json(),r=out.tables.find((t:any)=>t.id===source).relations[0];assert.equal(r.matchRate,50);assert.equal(r.missing,1);assert.equal(r.ambiguous,1);assert.ok(out.findings.some((f:any)=>f.kind==='rule'));
 const owner=c.store.user('u-admin')!,limited={...owner,id:'u-steward',role:'steward' as const,clearance:1,duties:{governance:[{type:'resource' as const,id:source},{type:'resource' as const,id:target}]}};const targetDoc=c.store.doc('mengine-demo',target)!;targetDoc.classification=3;c.store.saveDoc(targetDoc);const sourceDoc=c.store.doc('mengine-demo',source)!;sourceDoc.classification=1;sourceDoc.audience='organization';c.store.saveDoc(sourceDoc);
 const restricted=scanStructured(c.store,limited);assert.equal(restricted.tables.find(t=>t.id===source)?.relations.length,0);assert.ok(!JSON.stringify(restricted).includes('目标表'));
 assert.equal((await c.app.inject({url:'/api/governance/structured'})).statusCode,401);
 const login=await c.app.inject({method:'POST',url:'/api/auth/login',payload:{email:'external@mengine.demo',password:DEMO_PASSWORD}});const outsider={cookie:String(login.headers['set-cookie']).split(';')[0]};const outside=await state(c,outsider);assert.equal(outside.statusCode,200);assert.deepEqual(outside.json().tables,[]);assert.deepEqual(outside.json().findings,[]);
}));
test('同步失败与超期可持续发现，无变化不重复审计，成功检查后关闭问题',()=>fixture(async(c,h)=>{
 const id=await create(c,h);c.store.db.prepare('INSERT INTO database_sync_jobs VALUES(?,?,?)').run('job','mengine-demo',JSON.stringify({datasetId:id,id:'job',state:'failed',enabled:true,intervalMinutes:5,lastSuccess:'2020-01-01T00:00:00Z'}));
 let snapshot=(await state(c,h)).json();assert.ok(snapshot.findings.some((f:any)=>f.kind==='freshness'));assert.ok(snapshot.findings.some((f:any)=>f.kind==='sync'));
 const n=(c.store.db.prepare('SELECT COUNT(*) n FROM audit').get() as any).n;await state(c,h);assert.equal((c.store.db.prepare('SELECT COUNT(*) n FROM audit').get() as any).n,n);
 c.store.db.prepare('UPDATE database_sync_jobs SET data=? WHERE id=?').run(JSON.stringify({datasetId:id,id:'job',state:'succeeded',enabled:true,intervalMinutes:5,lastSuccess:new Date().toISOString()}),'job');snapshot=(await state(c,h)).json();assert.ok(snapshot.findings.filter((f:any)=>['freshness','sync'].includes(f.kind)).every((f:any)=>f.status==='resolved'));
 assert.ok(!(await c.app.inject({url:'/api/governance',headers:h})).json().items.some((d:any)=>d.id===id));
}));

test('业务规则检测识别互斥状态和不可能数值区间，不推测未知业务含义',()=>{
 assert.equal(contradictoryFilters([{field:'record_id',operator:'eq',value:'paid'},{field:'record_id',operator:'eq',value:'cancelled'}],[field as any]),true);
 const numberField={...field,type:'number'} as any;
 assert.equal(contradictoryFilters([{field:'record_id',operator:'gte',value:'100'},{field:'record_id',operator:'lte',value:'10'}],[numberField]),true);
 assert.equal(contradictoryFilters([{field:'record_id',operator:'gte',value:'10'},{field:'record_id',operator:'lte',value:'100'}],[numberField]),false);
});

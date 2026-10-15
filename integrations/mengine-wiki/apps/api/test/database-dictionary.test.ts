import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {buildServer} from '../src/server.js';
import {DEMO_PASSWORD} from '../src/seed.js';
import {reconcileDictionaryJobs} from '../src/data-dictionary.js';
import {validateConnection} from '../src/database-source.js';
async function fixture(fn:(ctx:Awaited<ReturnType<typeof buildServer>>,h:{cookie:string},root:string)=>Promise<void>){const root=await mkdtemp(join(tmpdir(),'database-dict-')),previous=process.env.DATABASE_SOURCE_ROOT;process.env.DATABASE_SOURCE_ROOT=join(root,'sources');await mkdir(join(root,'sources','mengine-demo'),{recursive:true});const file=join(root,'sources','mengine-demo','test.sqlite');const db=new Database(file);db.exec("CREATE TABLE payments(id INTEGER PRIMARY KEY, amount_cents INTEGER NOT NULL, phone TEXT, status TEXT); INSERT INTO payments VALUES(1,12345,'13812345678','paid'),(2,200,'13912345678','pending')");db.close();const ctx=await buildServer({demo:true,storage:root,model:{apiKey:'test-only',baseUrl:'https://example.test/v1',model:'test'}});ctx.model.complete=async()=>{throw Error('test model not stubbed');};const login=await ctx.app.inject({method:'POST',url:'/api/auth/login',payload:{email:'admin@mengine.demo',password:DEMO_PASSWORD}});const h={cookie:String(login.headers['set-cookie']).split(';')[0]};try{await fn(ctx,h,root);}finally{await ctx.app.close();if(previous===undefined)delete process.env.DATABASE_SOURCE_ROOT;else process.env.DATABASE_SOURCE_ROOT=previous;await rm(root,{recursive:true,force:true});}}
async function connect(ctx:any,h:any){const r=await ctx.app.inject({method:'POST',url:'/api/database-connections',headers:h,payload:{kind:'sqlite',name:'测试业务库',file:'test.sqlite'}});assert.equal(r.statusCode,201,r.body);assert.equal(r.json().secret,undefined);const id=r.json().id;const scan=await ctx.app.inject({method:'POST',url:`/api/database-connections/${id}/scan`,headers:h,payload:{}});assert.equal(scan.statusCode,200,scan.body);return scan.json();}
async function pull(ctx:any,h:any,c:any){const r=await ctx.app.inject({method:'POST',url:`/api/database-connections/${c.id}/pull`,headers:h,payload:{table:'payments',fingerprint:c.fingerprint,centsToYuan:true}});assert.equal(r.statusCode,200,r.body);return r.json().id;}
const definition={tableMeaning:'支付流水（待核对到账）',usageRules:'仅业务确认的paid状态用于到账分析',fields:[{name:'id',label:'支付ID',meaning:'支付记录唯一编号',unit:'不适用',rules:'唯一',evidence:'源库主键'},{name:'amount_yuan',label:'金额',meaning:'支付金额，是否到账需检查状态',unit:'人民币元',rules:'仅paid',evidence:'人工核对，导入时分转元'},{name:'phone',label:'电话',meaning:'联系号码',unit:'不适用',rules:'敏感',evidence:'业务负责人'},{name:'status',label:'支付状态',meaning:'当前流程状态',unit:'不适用',rules:'paid/pending含义由业务方确认',evidence:'业务负责人确认'}]};
test('SQLite连接按企业目录隔离，只读扫描及完整私有快照，金额转换精确且不泄露凭证',()=>fixture(async(ctx,h,root)=>{const c=await connect(ctx,h),id=await pull(ctx,h,c);const response=await ctx.app.inject({url:`/api/foundation/${id}`,headers:h});assert.equal(response.statusCode,200,response.body);const detail=response.json();assert.equal(detail.dataset.audience,'private');assert.equal(detail.total,2);assert.deepEqual(detail.items.map((r:any)=>r.values.amount_yuan).sort(),['123.45','2.00']);assert.equal(detail.dataset.fields.find((f:any)=>f.name==='phone').sensitive,true);const src=new Database(join(root,'sources','mengine-demo','test.sqlite'),{readonly:true});assert.equal((src.prepare('SELECT amount_cents FROM payments WHERE id=1').get() as any).amount_cents,12345);src.close();assert.ok(ctx.store.auditValid('mengine-demo'));const bad=await ctx.app.inject({method:'POST',url:`/api/database-connections/${c.id}/pull`,headers:h,payload:{table:'payments;drop table users',fingerprint:c.fingerprint}});assert.equal(bad.statusCode,400);const external=await ctx.app.inject({method:'POST',url:'/api/auth/login',payload:{email:'external@mengine.demo',password:DEMO_PASSWORD}});const eh={cookie:String(external.headers['set-cookie']).split(';')[0]};assert.equal((await ctx.app.inject({url:'/api/database-connections',headers:eh})).json().files.length,0);assert.equal((await ctx.app.inject({method:'POST',url:`/api/database-connections/${c.id}/scan`,headers:eh,payload:{}})).statusCode,404);}));
test('拒绝文件路径逃逸、目录外符号链接和普通岗位配置连接',()=>fixture(async(ctx,h,root)=>{assert.throws(()=>validateConnection({kind:'sqlite',name:'bad',file:'../test.sqlite'}));assert.throws(()=>validateConnection({kind:'postgres',name:'bad',host:'127.0.0.1',port:0,database:'test',username:'u',password:'p'}));await symlink(join(root,'sources','mengine-demo','test.sqlite'),join(root,'outside.sqlite'));await symlink(join(root,'outside.sqlite'),join(root,'sources','mengine-demo','escape.sqlite')); // resolves back inside: valid; test true outside below
 const outside=new Database(join(root,'private.sqlite'));outside.exec('CREATE TABLE secrets(x TEXT)');outside.close();await symlink(join(root,'private.sqlite'),join(root,'sources','mengine-demo','blocked.sqlite'));const r=await ctx.app.inject({method:'POST',url:'/api/database-connections',headers:h,payload:{kind:'sqlite',name:'blocked',file:'blocked.sqlite'}});assert.equal((await ctx.app.inject({method:'POST',url:`/api/database-connections/${r.json().id}/scan`,headers:h,payload:{}})).statusCode,400);const login=await ctx.app.inject({method:'POST',url:'/api/auth/login',payload:{email:'engineer@mengine.demo',password:DEMO_PASSWORD}});assert.equal((await ctx.app.inject({url:'/api/database-connections',headers:{cookie:String(login.headers['set-cookie']).split(';')[0]}})).statusCode,403);}));

test('模型仅接收元数据并自动生效，记录来源与模型版本，无需审批',()=>fixture(async(ctx,h)=>{
 const id=await pull(ctx,h,await connect(ctx,h));
 ctx.model.complete=async(_system,input)=>{assert.ok(!input.includes('13812345678'));assert.ok(!input.includes('123.45'));assert.ok(input.includes('amount_yuan'));return {text:JSON.stringify(definition),usage:null};};
 const r=await ctx.app.inject({method:'POST',url:`/api/foundation/${id}/dictionary/generate`,headers:h,payload:{}});assert.equal(r.statusCode,200,r.body);
 const d=(await ctx.app.inject({url:`/api/foundation/${id}/dictionary`,headers:h})).json();
 assert.equal(d.status,'generated');assert.equal(d.mode,'model-only');assert.equal(d.confirmed.origin,'model');assert.equal(d.confirmed.provider,'test');assert.equal(d.pendingProposal,null);assert.equal(ctx.store.proposals('mengine-demo').length,0);
 assert.ok(ctx.store.auditValid('mengine-demo'));
}));
test('人工提交已停用，源注释变化使自动口径失效',()=>fixture(async(ctx,h)=>{
 const id=await pull(ctx,h,await connect(ctx,h));ctx.model.complete=async()=>({text:JSON.stringify(definition),usage:null});
 await ctx.app.inject({method:'POST',url:`/api/foundation/${id}/dictionary/generate`,headers:h,payload:{}});
 assert.equal((await ctx.app.inject({method:'POST',url:`/api/foundation/${id}/dictionary/proposals`,headers:h,payload:{definition}})).statusCode,410);
 const row=ctx.store.db.prepare('SELECT data FROM data_sets WHERE id=?').get(id) as any,source=JSON.parse(row.data);source.fields[1].description+='新注释';ctx.store.db.prepare('UPDATE data_sets SET data=? WHERE id=?').run(JSON.stringify(source),id);
 assert.equal((await ctx.app.inject({url:`/api/foundation/${id}/dictionary`,headers:h})).json().status,'changed');
}));
test('并发生成受控，模型错误不能改写源字段与记录',()=>fixture(async(ctx,h)=>{
 const id=await pull(ctx,h,await connect(ctx,h));const before=JSON.stringify((await ctx.app.inject({url:`/api/foundation/${id}`,headers:h})).json());
 let release!:()=>void,entered!:()=>void;const begun=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
 ctx.model.complete=async()=>{entered();await gate;return {text:'invalid-json',usage:null};};
 const call=()=>ctx.app.inject({method:'POST',url:`/api/foundation/${id}/dictionary/generate`,headers:h,payload:{}});
 const first=call();await begun;assert.equal((await call()).statusCode,409);release();assert.equal((await first).statusCode,502);
 assert.equal(JSON.stringify((await ctx.app.inject({url:`/api/foundation/${id}`,headers:h})).json()),before);
}));
test('旧人工口径方案不可继续批准，非维护人员不能触发生成',()=>fixture(async(ctx,h)=>{
 const id=await pull(ctx,h,await connect(ctx,h)),doc=ctx.store.doc('mengine-demo',id)!;
 const proposal:any={id:'legacy-dict',tenantId:'mengine-demo',documentId:id,authorId:'u-admin',action:'dictionary',patch:{definition},reason:'旧方案',documentVersion:doc.version,policyVersion:doc.policyVersion,status:'pending',createdAt:new Date().toISOString()};ctx.store.proposal(proposal);
 assert.equal((await ctx.app.inject({method:'POST',url:'/api/proposals/legacy-dict/resolve',headers:h,payload:{decision:'approve'}})).statusCode,410);
 const login=await ctx.app.inject({method:'POST',url:'/api/auth/login',payload:{email:'external@mengine.demo',password:DEMO_PASSWORD}});
 const outside={cookie:String(login.headers['set-cookie']).split(';')[0]};
 assert.equal((await ctx.app.inject({method:'POST',url:`/api/foundation/${id}/dictionary/generate`,headers:outside,payload:{}})).statusCode,404);
}));
async function until(check:()=>boolean){for(let i=0;i<200;i++){if(check())return;await new Promise(r=>setTimeout(r,30));}assert.fail('后台任务未按时完成');}
test('导入事务完成后自动生成字段口径，不依赖打开页面，后台失败保留记录',()=>fixture(async(ctx,h)=>{
 let calls=0;ctx.model.complete=async(_s,input)=>{calls++;const parsed=JSON.parse(input);assert.ok(!input.includes('13812345678'));const id=parsed.baseDatasetId;assert.equal((ctx.store.db.prepare('SELECT COUNT(*) n FROM data_rows WHERE dataset_id=?').get(id) as any).n,2);assert.ok(ctx.store.flowEvents('mengine-demo',id).some(e=>e.event==='records-checked'));return {text:JSON.stringify(definition),usage:null};};
 const id=await pull(ctx,h,await connect(ctx,h));assert.equal((ctx.store.db.prepare('SELECT state FROM dictionary_jobs WHERE dataset_id=?').get(id) as any).state,'queued');
 await until(()=>(ctx.store.db.prepare('SELECT state FROM dictionary_jobs WHERE dataset_id=?').get(id) as any).state==='succeeded');assert.equal(calls,1);
 assert.equal((await ctx.app.inject({url:`/api/foundation/${id}/dictionary`,headers:h})).json().status,'generated');
 ctx.model.complete=async()=>{throw Error('unavailable');};const other=await pull(ctx,h,await connect(ctx,h));await until(()=>(ctx.store.db.prepare('SELECT state FROM dictionary_jobs WHERE dataset_id=?').get(other) as any).state==='retry_wait');assert.equal((ctx.store.db.prepare('SELECT COUNT(*) n FROM data_rows WHERE dataset_id=?').get(other) as any).n,2);
 const job=()=>ctx.store.db.prepare('SELECT * FROM dictionary_jobs WHERE dataset_id=?').get(other) as any;
 assert.equal(job().attempts,1);assert.ok(Date.parse(job().next_at)>Date.now()+25_000);
 const status=(await ctx.app.inject({url:`/api/foundation/${other}/dictionary`,headers:h})).json();assert.equal(status.busy,true);assert.equal(status.job.state,'retry_wait');
 // Advance only the persisted deadline: failures continue without a page or manual generation request.
 ctx.store.db.prepare("UPDATE dictionary_jobs SET next_at='' WHERE dataset_id=?").run(other);
 await until(()=>job().attempts===2);assert.ok(Date.parse(job().next_at)>Date.now()+55_000);
 ctx.model.complete=async()=>({text:JSON.stringify(definition),usage:null});
 ctx.store.db.prepare("UPDATE dictionary_jobs SET next_at='' WHERE dataset_id=?").run(other);
 await until(()=>job().state==='succeeded');assert.equal(job().next_at,'');assert.equal(job().error,'');
 assert.equal((await ctx.app.inject({url:`/api/foundation/${other}/dictionary`,headers:h})).json().status,'generated');

}));
test('定时同步更新同一数据集，处理源新增修改删除，保留旧快照；无变化不重复生成',()=>fixture(async(ctx,h,root)=>{
 ctx.model.complete=async()=>({text:JSON.stringify(definition),usage:null});const c=await connect(ctx,h);
 const first=await ctx.app.inject({method:'POST',url:`/api/database-connections/${c.id}/pull`,headers:h,payload:{table:'payments',fingerprint:c.fingerprint,centsToYuan:true,syncMinutes:5}});assert.equal(first.statusCode,200,first.body);const id=first.json().id;
 await until(()=>(ctx.store.db.prepare('SELECT state FROM dictionary_jobs WHERE dataset_id=?').get(id) as any).state==='succeeded');
 const j=JSON.parse((ctx.store.db.prepare('SELECT data FROM database_sync_jobs').get() as any).data);
 const run=()=>ctx.app.inject({method:'POST',url:`/api/database-sync/${j.id}/run`,headers:h,payload:{}});
 const before=ctx.store.doc('mengine-demo',id)!.version;assert.equal((await run()).json().unchanged,true);assert.equal(ctx.store.doc('mengine-demo',id)!.version,before);
 const source=new Database(join(root,'sources','mengine-demo','test.sqlite'));source.exec("UPDATE payments SET amount_cents=900 WHERE id=1; DELETE FROM payments WHERE id=2; INSERT INTO payments VALUES(3,500,'','paid')");source.close();
 const next=await run();assert.equal(next.statusCode,200,next.body);assert.equal(next.json().id,id);
 const values=(ctx.store.db.prepare('SELECT data FROM data_rows WHERE dataset_id=?').all(id) as any[]).map(r=>JSON.parse(r.data).values);assert.deepEqual(values.map(v=>v.amount_yuan).sort(),['5.00','9.00']);assert.equal((ctx.store.db.prepare('SELECT COUNT(*) n FROM database_sync_history WHERE dataset_id=?').get(id) as any).n,1);
 await until(()=>(ctx.store.db.prepare('SELECT state FROM dictionary_jobs WHERE dataset_id=?').get(id) as any).state==='succeeded');
 const source2=new Database(join(root,'sources','mengine-demo','test.sqlite'));source2.exec('DROP TABLE payments');source2.close();assert.equal((await run()).statusCode,409);assert.equal((ctx.store.db.prepare('SELECT COUNT(*) n FROM data_rows WHERE dataset_id=?').get(id) as any).n,2);
 assert.equal((await ctx.app.inject({method:'PATCH',url:`/api/database-sync/${j.id}`,headers:h,payload:{enabled:false,intervalMinutes:15}})).statusCode,200);assert.equal((await run()).statusCode,409);
}));
test('已有快照可启用定时同步，后台到期自动运行；撤销发起人权限后不再拉取',()=>fixture(async(ctx,h,root)=>{
 ctx.model.complete=async()=>({text:JSON.stringify(definition),usage:null});const c=await connect(ctx,h),id=await pull(ctx,h,c);
 await until(()=>(ctx.store.db.prepare('SELECT state FROM dictionary_jobs WHERE dataset_id=?').get(id) as any).state==='succeeded');
 const source=new Database(join(root,'sources','mengine-demo','test.sqlite'));source.exec('UPDATE payments SET amount_cents=333 WHERE id=1');source.close();
 const enabled=await ctx.app.inject({method:'POST',url:`/api/database-connections/${c.id}/sync`,headers:h,payload:{datasetId:id,intervalMinutes:5}});assert.equal(enabled.statusCode,200,enabled.body);const jobId=enabled.json().id;
 const job=()=>JSON.parse((ctx.store.db.prepare('SELECT data FROM database_sync_jobs WHERE id=?').get(jobId) as any).data);
 await until(()=>job().state==='succeeded');assert.ok((ctx.store.db.prepare('SELECT data FROM data_rows WHERE dataset_id=?').all(id) as any[]).some(r=>JSON.parse(r.data).values.amount_yuan==='3.33'));
 await until(()=>(ctx.store.db.prepare('SELECT state FROM dictionary_jobs WHERE dataset_id=?').get(id) as any).state==='succeeded');
 const before=ctx.store.doc('mengine-demo',id)!.version;const j=job();j.nextAt='2000-01-01T00:00:00.000Z';ctx.store.db.prepare('UPDATE database_sync_jobs SET data=? WHERE id=?').run(JSON.stringify(j),jobId);const actor=ctx.store.user('u-admin')!;ctx.store.addUser({...actor,id:'backup-admin',email:'backup-admin@test.invalid'},DEMO_PASSWORD);actor.active=false;ctx.store.saveUser(actor);
 await until(()=>job().state==='failed');assert.equal(ctx.store.doc('mengine-demo',id)!.version,before);
}));

test('历史导入漏队列与成功后口径失效自动补队列，不重复有效结果或重置退避',()=>fixture(async(ctx,h)=>{
 ctx.model.complete=async()=>({text:JSON.stringify(definition),usage:null});
 const id=await pull(ctx,h,await connect(ctx,h));
 ctx.store.db.prepare('DELETE FROM dictionary_jobs WHERE dataset_id=?').run(id);
 reconcileDictionaryJobs(ctx.store);
 const job=()=>ctx.store.db.prepare('SELECT * FROM dictionary_jobs WHERE dataset_id=?').get(id) as any;
 assert.equal(job().state,'queued');
 await until(()=>job().state==='succeeded');
 const finished=job().updated_at;reconcileDictionaryJobs(ctx.store);assert.equal(job().updated_at,finished);
 const row=ctx.store.db.prepare('SELECT data FROM data_sets WHERE id=?').get(id) as any;
 const changed=JSON.parse(row.data);changed.fields[0].description='源字段注释已更新';
 ctx.store.db.prepare('UPDATE data_sets SET data=? WHERE id=?').run(JSON.stringify(changed),id);
 reconcileDictionaryJobs(ctx.store);assert.equal(job().state,'queued');
 ctx.store.db.prepare("UPDATE dictionary_jobs SET state='retry_wait',attempts=4,next_at='2099-01-01T00:00:00.000Z' WHERE dataset_id=?").run(id);
 reconcileDictionaryJobs(ctx.store);assert.equal(job().attempts,4);assert.equal(job().next_at,'2099-01-01T00:00:00.000Z');
 ctx.store.db.prepare('DELETE FROM dictionary_jobs WHERE dataset_id=?').run(id);
 const user=ctx.store.user('u-admin')!;user.active=false;ctx.store.db.prepare('UPDATE users SET data=? WHERE id=?').run(JSON.stringify(user),user.id);
 reconcileDictionaryJobs(ctx.store);assert.equal(job(),undefined);
}));

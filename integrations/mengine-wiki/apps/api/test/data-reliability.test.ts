import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {Client, types} from 'pg';
import mysql from 'mysql2/promise';
import {buildServer} from '../src/server.js';
import {DEMO_PASSWORD} from '../src/seed.js';
import {scanStructured} from '../src/structured-governance.js';
import {dictionaryFingerprint} from '../src/dictionary-version.js';
import {documentFindings, recordDocumentDecision} from '../src/scene-document-governance.js';
import {withSource} from '../src/database-source.js';

async function fixture(fn:(c:Awaited<ReturnType<typeof buildServer>>,h:{cookie:string})=>Promise<void>){
 const dir=await mkdtemp(join(tmpdir(),'data-reliability-'));
 const c=await buildServer({demo:true,storage:dir});
 const login=await c.app.inject({method:'POST',url:'/api/auth/login',payload:{email:'admin@mengine.demo',password:DEMO_PASSWORD}});
 try{await fn(c,{cookie:String(login.headers['set-cookie']).split(';')[0]});}
 finally{await c.app.close();await rm(dir,{recursive:true,force:true});}
}
function dataset(c:any,id:string,values:string[]){
 const u=c.store.user('u-admin'),base=c.store.documents(u.tenantId).find((d:any)=>d.status==='ready');
 const d={...base,id,sha:id,kind:'数据表',title:id,ownerId:u.id,audience:'private',classification:0,version:1,policyVersion:1,issues:[]};
 c.store.saveDoc(d);
 const definition:any={id,fields:[{name:'record_id',label:'编号',type:'text',required:true,unique:true,sensitive:false,description:''}]};
 c.store.db.prepare('INSERT INTO data_sets VALUES(?,?,?)').run(id,u.tenantId,JSON.stringify(definition));
 for(const [i,value] of values.entries()){
  const row={id:id+'-'+i,version:1,values:{record_id:value},issues:[],status:'ready',updatedAt:new Date().toISOString(),actor:u.name};
  c.store.db.prepare('INSERT INTO data_rows VALUES(?,?,?,?,?,?)').run(row.id,id,u.tenantId,row.status,row.updatedAt,JSON.stringify(row));
 }
 return {d,definition,u};
}
test('人工校验不能使用变更前的业务规则，刷新后可校验，再次变更会重开',()=>fixture(async(c,h)=>{
 const {d,u}=dataset(c,'rules',['']);
 const scan=()=>scanStructured(c.store,u).findings.find(f=>f.datasetId===d.id&&f.kind==='field')!;
 const f=scan();
 const approve=()=>c.app.inject({method:'POST',url:`/api/governance/structured/issues/${f.id}/approve`,headers:h,payload:{expectedVersion:1,reason:'责任人核实'}});
 c.store.db.prepare('INSERT INTO data_dictionary VALUES(?,?,?)').run(d.id,u.tenantId,JSON.stringify({revision:1}));
 assert.equal((await approve()).statusCode,409);
 scan();assert.equal((await approve()).statusCode,200);
 assert.equal(scan().status,'resolved');
 c.store.db.prepare('UPDATE data_dictionary SET data=? WHERE dataset_id=?').run(JSON.stringify({revision:2}),d.id);
 assert.equal(scan().status,'open');
 assert.ok(c.store.auditValid(u.tenantId));
}));
test('只改变关联目标记录也会拒绝过期人工校验',()=>fixture(async(c,h)=>{
 const source=dataset(c,'source',['missing']),target=dataset(c,'target',['a']);
 const definition={relations:[{id:'link',name:'业务关联',targetId:target.d.id,keys:[{local:'record_id',foreign:'record_id'}],evidence:'测试',targetFingerprint:dictionaryFingerprint(c.store,source.u.tenantId,target.definition)}],templates:[]};
 c.store.db.prepare('INSERT INTO data_dictionary VALUES(?,?,?)').run(source.d.id,source.u.tenantId,JSON.stringify({revision:1,confirmed:{origin:'model',fingerprint:dictionaryFingerprint(c.store,source.u.tenantId,source.definition),definition}}));
 const f=scanStructured(c.store,source.u).findings.find(f=>f.kind==='relation')!;assert.ok(f);
 const r=JSON.parse((c.store.db.prepare('SELECT data FROM data_rows WHERE id=?').get('target-0') as any).data);r.values.record_id='b';
 c.store.db.prepare('UPDATE data_rows SET data=? WHERE id=?').run(JSON.stringify(r),r.id);
 const result=await c.app.inject({method:'POST',url:`/api/governance/structured/issues/${f.id}/approve`,headers:h,payload:{expectedVersion:1,reason:'旧页面提交'}});
 assert.equal(result.statusCode,409,result.body);
}));
test('同步状态变化会使旧人工豁免失效，不伪造同步成功',()=>fixture(async(c,h)=>{
 const {d,u}=dataset(c,'sync',['ok']);
 const job={id:'j',datasetId:d.id,state:'failed',enabled:true,intervalMinutes:5,lastSuccess:'2020-01-01T00:00:00Z',lastAttempt:'2020-01-02T00:00:00Z'};
 const save=()=>c.store.db.prepare('INSERT INTO database_sync_jobs VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(job.id,u.tenantId,JSON.stringify(job));save();
 const f=scanStructured(c.store,u).findings.find(f=>f.kind==='sync')!;
 assert.equal((await c.app.inject({method:'POST',url:`/api/governance/structured/issues/${f.id}/approve`,headers:h,payload:{expectedVersion:1,reason:'知晓风险'}})).statusCode,200);
 assert.equal(scanStructured(c.store,u).findings.find(x=>x.id===f.id)!.status,'resolved');
 job.lastAttempt=new Date().toISOString();save();
 assert.equal(scanStructured(c.store,u).findings.find(x=>x.id===f.id)!.status,'open');
 assert.equal(JSON.parse((c.store.db.prepare('SELECT data FROM database_sync_jobs WHERE id=?').get('j') as any).data).state,'failed');
}));
test('资料处理失败不会自动复检通过，旧人工确认在状态改变后失效',()=>fixture(async(c)=>{
 const u=c.store.user('u-admin')!,d=c.store.documents(u.tenantId).find(d=>d.status==='ready')!;
 d.issues=['内容信息量偏低'];let f=documentFindings(c.store,u,d)[0];assert.equal(f.status,'open');
 d.status='failed';f=documentFindings(c.store,u,d)[0];assert.equal(f.status,'open');assert.ok(!f.history.some(h=>h.action==='复检通过'));
 d.status='ready';recordDocumentDecision(c.store,u,d,f.id,'approve','核实内容有效');
 d.status='processing';f=documentFindings(c.store,u,d)[0];assert.equal(f.status,'open');assert.equal(f.manualApproval,undefined);
 d.status='ready';d.issues=[];d.reviewAt='2099-01-01T00:00:00Z';assert.equal(documentFindings(c.store,u,d)[0].status,'resolved');
}));
test('SQLite 同一次读取不会混入中途提交的新数据，失败后释放连接',async()=>{
 const root=await mkdtemp(join(tmpdir(),'source-snapshot-')),previous=process.env.DATABASE_SOURCE_ROOT;
 await mkdir(join(root,'tenant'));const file=join(root,'tenant','test.sqlite'),writer=new Database(file);
 writer.pragma('journal_mode=WAL');writer.exec("CREATE TABLE records(id INTEGER PRIMARY KEY,value TEXT);INSERT INTO records VALUES(1,'before')");process.env.DATABASE_SOURCE_ROOT=root;
 const config={kind:'sqlite' as const,name:'test',file:'test.sqlite'};
 try{
  await withSource(config,async a=>{const table=(await a.scan())[0];writer.exec("UPDATE records SET value='after'");assert.equal((await a.rows(table))[0].value,'before');},'tenant');
  await assert.rejects(withSource(config,async()=>{throw Error('injected');},'tenant'),/injected/);
  await withSource(config,async a=>assert.equal((await a.rows((await a.scan())[0]))[0].value,'after'),'tenant');
 }finally{writer.close();if(previous===undefined)delete process.env.DATABASE_SOURCE_ROOT;else process.env.DATABASE_SOURCE_ROOT=previous;await rm(root,{recursive:true,force:true});}
});
test('Postgres 驱动使用可重复只读事务且日期解析不受时区影响',async()=>{
 const statements:string[]=[];let client:any;
 const connect=mock.method(Client.prototype,'connect',async function(this:any){client=this;});
 const query=mock.method(Client.prototype,'query',async(sql:any)=>{statements.push(sql);return {rows:[]};});
 const end=mock.method(Client.prototype,'end',async()=>{});
 try{
  await withSource({kind:'postgres',name:'test',host:'db.invalid'},async()=>{
   assert.equal(client._types.getTypeParser(1082,'text')('2026-10-14'),'2026-10-14');
   assert.equal(client._types.getTypeParser(23,'text')('42'),42);
   assert.equal(statements[0],'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   throw Error('callback failed');
  },'tenant').then(()=>assert.fail('must fail'),e=>assert.match(e.message,/callback failed/));
  assert.equal(end.mock.callCount(),1);assert.notEqual(types.getTypeParser(1082,'text')('2026-10-14'),'2026-10-14');
 }finally{connect.mock.restore();query.mock.restore();end.mock.restore();}
});
test('MySQL 拒绝无法提供一致快照的存储引擎，并在失败后关闭连接',async()=>{
 const statements:string[]=[];let ended=false;
 const connection=mock.method(mysql,'createConnection',async()=>({query:async(sql:any)=>{statements.push(sql);return [[]];},execute:async()=>[[{table_name:'legacy',storage_engine:'MyISAM'}]],end:async()=>{ended=true;},destroy:()=>{}}) as any);
 try{
  await assert.rejects(withSource({kind:'mysql',name:'test'},a=>a.scan(),'tenant'),/InnoDB/);
  assert.deepEqual(statements.slice(1),['SET TRANSACTION ISOLATION LEVEL REPEATABLE READ','START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY']);assert.ok(ended);
 }finally{connection.mock.restore();}
});

test('超期只阻止模型使用而保留历史记录；无变化成功检查即可恢复且不改变版本',()=>fixture(async(c)=>{
 const {d,u,definition}=dataset(c,'fresh',['a']);
 const {queryDataset,listDatasets}=await import('../src/foundation-query.js');
 const {Conversations}=await import('../src/conversations.js');
 const {datasetAvailability}=await import('../src/data-availability.js');
 definition.provenance={connectionId:'conn',table:'business',sourceFingerprint:'schema'};
 c.store.db.prepare('UPDATE data_sets SET data=? WHERE id=?').run(JSON.stringify(definition),d.id);
 c.store.db.prepare('INSERT INTO database_connections VALUES(?,?,?)').run('conn',u.tenantId,JSON.stringify({id:'conn',fingerprint:'schema'}));
 const job={id:'freshjob',datasetId:d.id,connectionId:'conn',table:'business',state:'failed',enabled:true,intervalMinutes:5,lastSuccess:'2020-01-01T00:00:00Z'};
 const save=()=>c.store.db.prepare('INSERT INTO database_sync_jobs VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(job.id,u.tenantId,JSON.stringify(job));save();
 assert.throws(()=>queryDataset(c.store,u,d.id,{operation:'count'},true),/超过两个同步周期/);
 assert.equal(queryDataset(c.store,u,d.id,{operation:'count'}).result.matchedRecords,1);
 assert.ok(!listDatasets(c.store,u).some(x=>x.document.id===d.id));
 const conversations=new Conversations(c.store),dependency=[{documentId:d.id,version:1,policyVersion:1}];
 assert.equal(conversations.valid(u,dependency,u.clearance),false);
 job.lastSuccess=new Date().toISOString();job.state='succeeded';save();
 const result=queryDataset(c.store,u,d.id,{operation:'count'},true);
 assert.equal(result.result.sourceFreshness.mode,'scheduled');assert.equal(result.document.version,1);
 assert.equal(conversations.valid(u,dependency,u.clearance),true);
 assert.equal(datasetAvailability(c.store,u.tenantId,d.id,Date.parse(job.lastSuccess)+600000).allowed,false);
 job.enabled=false;save();assert.throws(()=>queryDataset(c.store,u,d.id,{operation:'count'},true),/停用/);
 assert.equal(c.store.doc(u.tenantId,d.id)!.version,1);
 assert.equal(datasetAvailability(c.store,'different-tenant',d.id).allowed,false);
}));
test('来源结构变化与连接停用会阻止模型读取，独立历史导入仍明确其时效限制',()=>fixture(async(c)=>{
 const {d,u,definition}=dataset(c,'availability',['a']);
 const {queryDataset}=await import('../src/foundation-query.js');
 assert.equal(queryDataset(c.store,u,d.id,{operation:'count'},true).result.sourceFreshness.mode,'historical');
 definition.provenance={connectionId:'conn',table:'business',sourceFingerprint:'schema'};
 c.store.db.prepare('UPDATE data_sets SET data=? WHERE id=?').run(JSON.stringify(definition),d.id);
 const save=(value:any)=>c.store.db.prepare('INSERT INTO database_connections VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run('conn',u.tenantId,JSON.stringify(value));
 save({fingerprint:'new-schema'});assert.throws(()=>queryDataset(c.store,u,d.id,{operation:'count'},true),/来源结构/);
 save({fingerprint:'schema',disabled:true});assert.throws(()=>queryDataset(c.store,u,d.id,{operation:'count'},true),/连接不可用/);
 save({fingerprint:'schema'});assert.equal(queryDataset(c.store,u,d.id,{operation:'count'},true).result.sourceFreshness.mode,'historical');
}));

test('源表超限和发布事务中断都保留旧数据，恢复后重试只发布一次',()=>fixture(async(c,h)=>{
 const root=await mkdtemp(join(tmpdir(),'sync-failure-')),previous=process.env.DATABASE_SOURCE_ROOT;
 await mkdir(join(root,'mengine-demo'));process.env.DATABASE_SOURCE_ROOT=root;
 const source=new Database(join(root,'mengine-demo','source.sqlite'));
 source.exec("CREATE TABLE records(id INTEGER PRIMARY KEY,value TEXT);INSERT INTO records VALUES(1,'original')");
 try{
  const created=await c.app.inject({method:'POST',url:'/api/database-connections',headers:h,payload:{kind:'sqlite',name:'合成故障源',file:'source.sqlite'}});assert.equal(created.statusCode,201);
  const id=created.json().id,scan=await c.app.inject({method:'POST',url:`/api/database-connections/${id}/scan`,headers:h});assert.equal(scan.statusCode,200);
  const imported=await c.app.inject({method:'POST',url:`/api/database-connections/${id}/pull`,headers:h,payload:{table:'records',fingerprint:scan.json().fingerprint,syncMinutes:5}});assert.equal(imported.statusCode,200,imported.body);
  const datasetId=imported.json().id,job=JSON.parse((c.store.db.prepare('SELECT data FROM database_sync_jobs WHERE tenant_id=?').get('mengine-demo') as any).data);
  const run=()=>c.app.inject({method:'POST',url:`/api/database-sync/${job.id}/run`,headers:h,payload:{}});
  const rows=()=>c.store.db.prepare('SELECT data FROM data_rows WHERE tenant_id=? AND dataset_id=? ORDER BY id').all('mengine-demo',datasetId);
  const before=rows(),version=c.store.doc('mengine-demo',datasetId)!.version;
  source.exec("WITH RECURSIVE n(x) AS (SELECT 2 UNION ALL SELECT x+1 FROM n WHERE x<10001) INSERT INTO records SELECT x,'extra' FROM n");
  assert.equal((await run()).statusCode,400);assert.deepEqual(rows(),before);assert.equal(c.store.doc('mengine-demo',datasetId)!.version,version);
  source.exec("DELETE FROM records WHERE id>1;UPDATE records SET value='changed'");
  const save=c.store.saveDoc.bind(c.store),interrupted=mock.method(c.store,'saveDoc',(d:any,event:any)=>{if(d.id===datasetId&&d.version>version)throw Error('injected commit failure');return save(d,event);});
  try{assert.equal((await run()).statusCode,502);}finally{interrupted.mock.restore();}
  assert.deepEqual(rows(),before);assert.equal(c.store.doc('mengine-demo',datasetId)!.version,version);
  assert.equal((c.store.db.prepare('SELECT COUNT(*) n FROM database_sync_history WHERE dataset_id=?').get(datasetId) as any).n,0);
  assert.equal((await run()).statusCode,200);assert.equal(c.store.doc('mengine-demo',datasetId)!.version,version+1);
  assert.equal(JSON.parse((rows()[0] as any).data).values.value,'changed');assert.equal((await run()).json().unchanged,true);
  assert.equal(c.store.doc('mengine-demo',datasetId)!.version,version+1);assert.ok(c.store.auditValid('mengine-demo'));
 }finally{source.close();if(previous===undefined)delete process.env.DATABASE_SOURCE_ROOT;else process.env.DATABASE_SOURCE_ROOT=previous;await rm(root,{recursive:true,force:true});}
}));

test('总台导出撤下超期数据并在同步恢复后重新提供，来源记录不删除',async()=>{
 const {createHmac,randomUUID}=await import('node:crypto');
 const previous=process.env.MENGINE_PLATFORM_BRIDGE_KEY,secret='isolated-reliability-test-key-'.repeat(2);process.env.MENGINE_PLATFORM_BRIDGE_KEY=secret;
 try{await fixture(async(c)=>{
  const {d,u,definition}=dataset(c,'export-fresh',['a']);definition.provenance={connectionId:'conn',table:'business',sourceFingerprint:'schema'};
  c.store.db.prepare('UPDATE data_sets SET data=? WHERE id=?').run(JSON.stringify(definition),d.id);
  c.store.db.prepare('INSERT INTO database_connections VALUES(?,?,?)').run('conn',u.tenantId,JSON.stringify({fingerprint:'schema'}));
  const job={id:'export-job',datasetId:d.id,connectionId:'conn',table:'business',enabled:true,intervalMinutes:5,lastSuccess:new Date().toISOString()};
  const save=()=>c.store.db.prepare('INSERT INTO database_sync_jobs VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(job.id,u.tenantId,JSON.stringify(job));save();
  c.store.db.prepare('INSERT INTO platform_tenant_bindings VALUES(?,?,?)').run('enterprise',u.tenantId,u.id);
  const exported=async()=>{
   const payload=Buffer.from(JSON.stringify({tenant:'enterprise',path:'/scene-export',method:'GET',actor:'central-operator',nonce:randomUUID(),at:Date.now()})).toString('base64url');
   const r=await c.app.inject({method:'POST',url:'/api/internal/platform-scene',payload:{payload,signature:createHmac('sha256',secret).update(payload).digest('hex')}});assert.equal(r.statusCode,200,r.body);return r.json();
  };
  const fresh=await exported();assert.ok(fresh.assets.some((a:any)=>a.id===d.id));
  job.lastSuccess='2020-01-01T00:00:00Z';save();const stale=await exported();assert.ok(!stale.assets.some((a:any)=>a.id===d.id));assert.notEqual(stale.revision,fresh.revision);
  assert.equal((c.store.db.prepare('SELECT COUNT(*) n FROM data_rows WHERE dataset_id=?').get(d.id) as any).n,1);
  job.lastSuccess=new Date().toISOString();save();assert.equal((await exported()).revision,fresh.revision);
 });}finally{if(previous===undefined)delete process.env.MENGINE_PLATFORM_BRIDGE_KEY;else process.env.MENGINE_PLATFORM_BRIDGE_KEY=previous;}
});

test('取数中租约被接管后旧任务不能发布，也不能释放新任务的凭据',()=>fixture(async(c,h)=>{
 const {acquireSourceLease}=await import('../src/source-lease.js');
 let release!:()=>void,entered!:()=>void,blocked=false;
 const gate=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);
 const connect=mock.method(Client.prototype,'connect',async()=>{}),end=mock.method(Client.prototype,'end',async()=>{});
 const query=mock.method(Client.prototype,'query',async(sql:any)=>{
  if(String(sql).includes('information_schema.columns'))return {rows:[{table_name:'records',column_name:'id',data_type:'integer',is_nullable:'NO',is_primary:true}]};
  if(String(sql).startsWith('SELECT')){if(blocked){entered();await gate;}return {rows:[{id:1}]};}
  return {rows:[]};
 });
 try{
  const created=await c.app.inject({method:'POST',url:'/api/database-connections',headers:h,payload:{kind:'postgres',name:'测试租约',host:'db.invalid',port:5432,database:'test',username:'test',password:'test-only'}});assert.equal(created.statusCode,201);
  const id=created.json().id,scan=await c.app.inject({method:'POST',url:`/api/database-connections/${id}/scan`,headers:h});assert.equal(scan.statusCode,200);
  blocked=true;const pending=c.app.inject({method:'POST',url:`/api/database-connections/${id}/pull`,headers:h,payload:{table:'records',fingerprint:scan.json().fingerprint}}).then(r=>r);
  let successor:ReturnType<typeof acquireSourceLease>|undefined;
  try{
   await Promise.race([started,pending.then(r=>{throw Error('取数提前结束：'+r.statusCode);})]);
   c.store.db.prepare('UPDATE source_leases SET expires=0 WHERE tenant_id=? AND resource=?').run('mengine-demo','connection:'+id);
   successor=acquireSourceLease(c.store,'mengine-demo','connection:'+id);
  }finally{release();}
  assert.equal((await pending).statusCode,409);successor!.assert();successor!.release();
  assert.equal((c.store.db.prepare('SELECT COUNT(*) n FROM data_sets').get() as any).n,0);
  assert.equal((c.store.db.prepare('SELECT COUNT(*) n FROM data_rows').get() as any).n,0);
 }finally{release();connect.mock.restore();query.mock.restore();end.mock.restore();}
}));

test('崩溃遗留 running 任务在凭据过期后自动恢复，不等待未来的下一周期',()=>fixture(async(c,h)=>{
 const root=await mkdtemp(join(tmpdir(),'sync-recovery-')),previous=process.env.DATABASE_SOURCE_ROOT;
 await mkdir(join(root,'mengine-demo'));process.env.DATABASE_SOURCE_ROOT=root;
 const source=new Database(join(root,'mengine-demo','source.sqlite'));
 source.exec("CREATE TABLE records(id INTEGER PRIMARY KEY,value TEXT);INSERT INTO records VALUES(1,'before')");
 try{
  const created=await c.app.inject({method:'POST',url:'/api/database-connections',headers:h,payload:{kind:'sqlite',name:'恢复测试',file:'source.sqlite'}}),id=created.json().id;
  const scan=await c.app.inject({method:'POST',url:`/api/database-connections/${id}/scan`,headers:h});assert.equal(scan.statusCode,200);
  const imported=await c.app.inject({method:'POST',url:`/api/database-connections/${id}/pull`,headers:h,payload:{table:'records',fingerprint:scan.json().fingerprint,syncMinutes:1440}});assert.equal(imported.statusCode,200,imported.body);
  const datasetId=imported.json().id,job=JSON.parse((c.store.db.prepare('SELECT data FROM database_sync_jobs').get() as any).data);
  source.exec("UPDATE records SET value='after'");job.state='running';job.nextAt='2099-01-01T00:00:00Z';c.store.db.prepare('UPDATE database_sync_jobs SET data=? WHERE id=?').run(JSON.stringify(job),job.id);
  c.store.db.prepare('INSERT INTO source_leases VALUES(?,?,?,?)').run('mengine-demo','job:'+job.id,'abandoned',0);
  c.store.db.prepare('INSERT INTO source_leases VALUES(?,?,?,?)').run('mengine-demo','connection:'+id,'abandoned',0);
  const deadline=Date.now()+8000;let state=job;
  while(Date.now()<deadline){state=JSON.parse((c.store.db.prepare('SELECT data FROM database_sync_jobs WHERE id=?').get(job.id) as any).data);if(state.state==='succeeded')break;await new Promise(r=>setTimeout(r,50));}
  assert.equal(state.state,'succeeded');assert.equal(JSON.parse((c.store.db.prepare('SELECT data FROM data_rows WHERE dataset_id=?').get(datasetId) as any).data).values.value,'after');
  assert.equal((c.store.db.prepare('SELECT COUNT(*) n FROM source_leases').get() as any).n,0);
 }finally{source.close();if(previous===undefined)delete process.env.DATABASE_SOURCE_ROOT;else process.env.DATABASE_SOURCE_ROOT=previous;await rm(root,{recursive:true,force:true});}
}));

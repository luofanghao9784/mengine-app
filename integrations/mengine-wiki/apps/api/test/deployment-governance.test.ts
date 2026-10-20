import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildServer} from '../src/server.js';
import {seedDataset,seedRows} from './helpers/structured-fixture.js';
import {deploymentContext,importDeployment} from '../src/deployment-governance.js';
import {readDataset,queryDataset} from '../src/foundation-query.js';
import {createBusinessKnowledge} from '../src/business-knowledge.js';
import {reconcileDictionaryJobs} from '../src/data-dictionary.js';
import {createHmac,randomUUID} from 'node:crypto';
async function fixture(fn:(c:any,u:any,id:string,p:any)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'deployment-governance-'));
 const c=await buildServer({demo:true,storage:root,model:{enabled:true,apiKey:'synthetic',baseUrl:'https://example.invalid',model:'synthetic-model'}});
 c.model.complete=async()=>{throw Error('Unexpected model call');};
 try{
 const u=c.store.user('u-admin')!;
 const id=seedDataset(c.store,u,'收款',[{name:'id',label:'编号',type:'text',required:true,unique:true,sensitive:false,description:'主键'},{name:'amount',label:'金额',type:'number',required:true,unique:false,sensitive:false,description:'合成金额'}],[{id:'01',amount:'12.30'},{id:'02',amount:'7.70'}]);
 const p={contractVersion:'1.0',tenantId:u.tenantId,id:'first',producer:'Codex',datasets:deploymentContext(c.store,u,[id]).datasets.map(d=>({id:d.id,token:d.token,definition:{tableMeaning:'收款记录',usageRules:'金额不等同到账',fields:d.fields.map(f=>({name:f.name,label:f.label,meaning:f.description,unit:f.type==='number'?'元':'',rules:'保留源值',evidence:'合成源字典 v1'})),relations:[],templates:[]},fieldEvidence:d.fields.map(f=>({column:f.name,status:'SOURCE_DOCUMENTED',reference:'test/source-v1'})),knowledge:[{title:'收款口径',intro:'业务规则',content:'金额与到账状态分别核验。',fields:['amount']}]}))};
 await fn(c,u,id,p);
 }finally{await c.app.close();await rm(root,{recursive:true,force:true});}
}
test('deployment preview rolls back; atomic import is idempotent and retains provenance',()=>fixture(async(c,u,id,p)=>{
 const before=c.store.doc(u.tenantId,id).version;
 const preview=importDeployment(c.store,u,p,true);assert.equal(preview.datasets[0].checkedRows,2);
 assert.equal(c.store.doc(u.tenantId,id).version,before);assert.equal(readDataset(c.store,u,id).dictionaryStatus,'unconfirmed');
 const result=importDeployment(c.store,u,p);assert.equal(result.datasets[0].checkedRows,2);assert.equal(readDataset(c.store,u,id).dictionaryStatus,'generated');
 assert.equal(importDeployment(c.store,u,p).replayed,true);assert.equal(c.store.doc(u.tenantId,id).version,before+1);
 assert.throws(()=>importDeployment(c.store,u,{...p,producer:'different'}),/不同内容/);
 const knowledge=createBusinessKnowledge(c.store,c.model).snapshot(u).items;assert.equal(knowledge[0].model,'Codex');assert.equal(knowledge[0].content,'金额与到账状态分别核验。');
}));
test('cross tenant, revoked actor, stale source and partial invalid package are rejected without writes',()=>fixture(async(c,u,id,p)=>{
 assert.throws(()=>importDeployment(c.store,{...u,tenantId:'another'},p));
 assert.throws(()=>importDeployment(c.store,{...u,active:false},p));
 const bad=structuredClone(p);bad.datasets.push({...bad.datasets[0],id:'missing'});assert.throws(()=>importDeployment(c.store,u,bad));assert.equal(readDataset(c.store,u,id).dictionaryStatus,'unconfirmed');
 const before=c.store.doc(u.tenantId,id).version;const invalid=structuredClone(p);invalid.datasets[0].analysis={fingerprint:'wrong',content:{articles:[]}};assert.throws(()=>importDeployment(c.store,u,invalid));assert.equal(c.store.doc(u.tenantId,id).version,before);assert.equal(readDataset(c.store,u,id).dictionaryStatus,'unconfirmed');
 seedRows(c.store,id,[{id:'01',amount:'30'}]);assert.throws(()=>importDeployment(c.store,u,p),/来源版本/);
}));
test('row changes retain Codex baseline; server model refreshes analysis; schema changes invalidate both',()=>fixture(async(c,u,id,p)=>{
 importDeployment(c.store,u,p);const b=createBusinessKnowledge(c.store,c.model);
 let calls=0;c.model.complete=async(_s:string,input:string)=>{calls++;const facts=JSON.parse(input).facts;const fact=facts.find((f:any)=>f.id!=='F1');return {text:JSON.stringify({articles:[{title:'金额范围',intro:'本期观察',content:fact.text,evidence:[fact.id]}]}),usage:null};};
 await b.learn(u,id,()=>u);assert.equal(calls,1);
 assert.equal(b.snapshot(u).items.length,2);
 seedRows(c.store,id,[{id:'01',amount:'32.10'}]);const raw=c.store.db.prepare('SELECT data FROM data_sets WHERE id=?').get(id);const def=JSON.parse(raw.data);def.syncHash='changed-rows';def.updatePolicy='定期全量同步';c.store.db.prepare('UPDATE data_sets SET data=? WHERE id=?').run(JSON.stringify(def),id);
 assert.equal(readDataset(c.store,u,id).dictionaryStatus,'generated');assert.equal(b.snapshot(u).items.length,1);
 await b.learn(u,id,()=>u);assert.equal(calls,2);assert.equal(b.snapshot(u).items.length,2);
 def.fields[1].type='text';c.store.db.prepare('UPDATE data_sets SET data=? WHERE id=?').run(JSON.stringify(def),id);
 assert.equal(readDataset(c.store,u,id).dictionaryStatus,'changed');assert.equal(b.snapshot(u).items.length,0);reconcileDictionaryJobs(c.store);assert.equal(calls,2);
}));
test('preview statistics can initialize real knowledge without invoking runtime model',()=>fixture(async(c,u,id,p)=>{
 const preview=importDeployment(c.store,u,p,true);const profile=preview.datasets[0].profile;const fact=profile.input.facts.find((f:any)=>f.id!=='F1');
 p.datasets[0].analysis={fingerprint:profile.fingerprint,content:{articles:[{title:'金额范围',intro:'首轮分析',content:fact.text,evidence:[fact.id]}]}};
 importDeployment(c.store,u,p);assert.equal(createBusinessKnowledge(c.store,c.model).snapshot(u).items.length,2);
}));
test('signed deployment bridge rejects browser identity and invalid signature',()=>fixture(async(c,u,id,p)=>{
 // Server without bridge key fails closed. Operator context is never a public route.
 const r=await c.app.inject({method:'POST',url:'/api/internal/platform-scene',payload:{payload:'x',signature:'0'.repeat(64)}});assert.equal(r.statusCode,503);
 const direct=await c.app.inject({method:'POST',url:'/api/deployment-governance/apply',payload:p});assert.ok([401,404].includes(direct.statusCode));
}));

test('deployed-source registry enforces tenant isolation, scalar projection and full-table bounds',async()=>{
 const {writeFile}=await import('node:fs/promises');const {withSource,validateConnection}=await import('../src/database-source.js');
 const root=await mkdtemp(join(tmpdir(),'deployed-source-'));const previous=process.env.DATABASE_DEPLOYED_SOURCES;
 try{
  const registry=join(root,'registry.json');process.env.DATABASE_DEPLOYED_SOURCES=registry;
  const result={contractVersion:'1.0',tenantId:'a',tables:[{name:'payments',comment:'synthetic',columns:[{name:'amount',type:'decimal',nullable:true,primary:false,comment:''}]}],rows:{payments:[{amount:null},{amount:'123456789012.123456'}]}};
  async function install(value:any){await writeFile(registry,JSON.stringify({sources:[{id:'fixed',tenantId:'a',command:[process.execPath,'-e','process.stdout.write('+JSON.stringify(JSON.stringify(value))+')']}]}),{mode:0o600});}
  await install(result);const config=validateConnection({kind:'deployed',name:'synthetic',provider:'fixed'});
  const rows=await withSource(config,async a=>a.rows((await a.scan())[0]),'a');assert.equal(rows[0].amount,null);assert.equal(rows[1].amount,'123456789012.123456');
  await assert.rejects(()=>withSource(config,a=>a.scan(),'b'));
  await install({...result,rows:{payments:[{amount:1}]}});await assert.rejects(()=>withSource(config,a=>a.scan(),'a'));
  await install({...result,rows:{payments:Array.from({length:10001},()=>({amount:'1'}))}});await assert.rejects(()=>withSource(config,a=>a.scan(),'a'));
  assert.throws(()=>validateConnection({kind:'deployed',name:'x',provider:'fixed',host:'evil'}));
 }finally{if(previous===undefined)delete process.env.DATABASE_DEPLOYED_SOURCES;else process.env.DATABASE_DEPLOYED_SOURCES=previous;await rm(root,{recursive:true,force:true});}
});

test('signed operator applies only bound tenant; customer realm and replay cannot import',async()=>{
 const previous=process.env.MENGINE_PLATFORM_BRIDGE_KEY;const key='synthetic-deployment-key-'.repeat(3);process.env.MENGINE_PLATFORM_BRIDGE_KEY=key;
 try{await fixture(async(c,u,id,p)=>{
  c.store.db.prepare('INSERT INTO platform_tenant_bindings VALUES(?,?,?)').run('central-tenant',u.tenantId,u.id);
  c.store.db.prepare('INSERT INTO platform_actor_bindings VALUES(?,?,?)').run('central-tenant','admin-actor',u.id);
  const body=(actor:string,tenant='central-tenant')=>{const payload=Buffer.from(JSON.stringify({tenant,actor,nonce:randomUUID(),at:Date.now(),method:'POST',path:'/deployment-governance/apply',body:p})).toString('base64url');return {payload,signature:createHmac('sha256',key).update(payload).digest('hex')};};
  const post=(payload:any)=>c.app.inject({method:'POST',url:'/api/internal/platform-scene',payload});
  assert.equal((await post(body('customer:admin-actor'))).statusCode,403);
  assert.equal((await post(body('deployment:codex','unbound'))).statusCode,404);
  const signed=body('deployment:codex');assert.equal((await post({...signed,signature:'0'.repeat(64)})).statusCode,401);
  const result=await post(signed);assert.equal(result.statusCode,200,result.body);assert.equal((await post(signed)).statusCode,409);
 });}finally{if(previous===undefined)delete process.env.MENGINE_PLATFORM_BRIDGE_KEY;else process.env.MENGINE_PLATFORM_BRIDGE_KEY=previous;}
});

test('unknown fields and non-additive balances stay outside model aggregation',()=>fixture(async(c,u,id,p)=>{
 p.datasets[0].analysisPolicy={excludeFields:[],noSumFields:['amount']};importDeployment(c.store,u,p);
 assert.throws(()=>queryDataset(c.store,u,id,{operation:'sum',field:'amount'},true),/不能无条件累加/);
 assert.equal((queryDataset(c.store,u,id,{operation:'max',field:'amount'},true).result as any).groups[0].value,'12.3');
 const p2=structuredClone(p);p2.id='unknown';p2.datasets[0].token=deploymentContext(c.store,u,[id]).datasets[0].token;p2.datasets[0].fieldEvidence[1].status='UNKNOWN';importDeployment(c.store,u,p2);
 assert.throws(()=>queryDataset(c.store,u,id,{operation:'max',field:'amount'},true),/受限字段/);
 assert.ok(!(queryDataset(c.store,u,id,{operation:'records'},true).result as any).fields.some((f:any)=>f.name==='amount'));
 assert.ok((queryDataset(c.store,u,id,{operation:'records'},false).result as any).fields.some((f:any)=>f.name==='amount'));
}));

test('deployed relationships survive target row updates but reject target schema changes',()=>fixture(async(c,u,id,p)=>{
 const {validateSemantics}=await import('../src/business-queries.js');
 const target=seedDataset(c.store,u,'关联目标',[{name:'id',label:'编号',type:'text',required:true,unique:true,sensitive:false,description:'稳定编号'}],[{id:'01'}]);
 p.datasets[0].definition.relations=[{id:'target',name:'合成源外键',targetId:target,keys:[{local:'id',foreign:'id'}],evidence:'合成数据库外键'}];importDeployment(c.store,u,p);
 const rules=readDataset(c.store,u,id).business;assert.ok(rules.relations[0].targetFingerprint.startsWith('schema:'));
 const raw=JSON.parse(c.store.db.prepare('SELECT data FROM data_sets WHERE id=?').get(target).data);raw.syncHash='updated-business-rows';raw.updatePolicy='每小时全量同步';seedRows(c.store,target,[{id:'01'},{id:'02'}]);c.store.db.prepare('UPDATE data_sets SET data=? WHERE id=?').run(JSON.stringify(raw),target);
 assert.doesNotThrow(()=>validateSemantics(c.store,u,id,rules));
 raw.fields[0].description='changed source definition';c.store.db.prepare('UPDATE data_sets SET data=? WHERE id=?').run(JSON.stringify(raw),target);
 assert.throws(()=>validateSemantics(c.store,u,id,rules),/结构发生变化/);
}));

test('conditional sum requires exact documented fields and never unblocks raw model sums',()=>fixture(async(c,u,id,p)=>{
 const d=p.datasets[0];d.definition.fields.find((f:any)=>f.name==='amount').unit='分';
 d.analysisPolicy={excludeFields:[],noSumFields:['amount'],conditionalSums:[{field:'amount',equalsFilters:{id:'01'},conversion:'CENTS_TO_YUAN'}]};
 const invalid=structuredClone(p);invalid.datasets[0].analysisPolicy.conditionalSums[0].equalsFilters={missing:'01'};
 assert.throws(()=>importDeployment(c.store,u,invalid),/受控求和条件/);
 importDeployment(c.store,u,p);assert.equal(readDataset(c.store,u,id).analysisPolicy.conditionalSums[0].conversion,'CENTS_TO_YUAN');
 assert.throws(()=>queryDataset(c.store,u,id,{operation:'sum',field:'amount'},true),/不能无条件累加/);
}));

test('scene topic detail retains source versions while synchronization exports original source identities',()=>fixture(async(c,u,id,p)=>{
 const {DEMO_PASSWORD}=await import('../src/seed.js');
 p.datasets[0].knowledge[0].topicKey='receipts.rules';
 const invalid=structuredClone(p);invalid.datasets[0].knowledge[0].topicKey='../bad';
 assert.throws(()=>importDeployment(c.store,u,invalid),/知识点标识/);
 importDeployment(c.store,u,p);
 const login=await c.app.inject({method:'POST',url:'/api/auth/login',payload:{email:u.email,password:DEMO_PASSWORD}});
 assert.equal(login.statusCode,200);const headers={cookie:String(login.headers['set-cookie']).split(';')[0]};
 const grouped=(await c.app.inject({url:'/api/scene-knowledge',headers})).json();
 const topic=grouped.items.find((x:any)=>x.id.startsWith('topic-'));assert.ok(topic);assert.equal(topic.sources[0].id,id);
 const detail=await c.app.inject({url:'/api/scene-knowledge/'+topic.id+'/source',headers});assert.equal(detail.statusCode,200);assert.equal(detail.json().sources[0].version,c.store.doc(u.tenantId,id).version);
 const raw=(await c.app.inject({url:'/api/scene-knowledge?view=sources',headers})).json();assert.ok(raw.items.some((x:any)=>x.id==='deployment-'+id+'-0'));assert.ok(!raw.items.some((x:any)=>x.id.startsWith('topic-')));
}));

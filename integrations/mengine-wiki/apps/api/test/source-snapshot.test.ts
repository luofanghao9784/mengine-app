import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateSnapshot} from '../src/source-snapshot.js';
import {buildServer} from '../src/server.js';
import {DEMO_PASSWORD} from '../src/seed.js';
function snapshot(n=12001){const rows=Array.from({length:n},(_,i)=>({id:String(i).padStart(6,'0'),amount:i===0?null:'123456789012345678.123456'}));return {contractVersion:'2.0',tenantId:'mengine-demo',snapshot:{id:'snapshot-a',readOnly:true,isolation:'REPEATABLE READ',readAt:'synthetic'},tables:[{name:'facts',comment:'synthetic',columns:[{name:'id',type:'text',nullable:false,primary:true,comment:''},{name:'amount',type:'text',nullable:true,primary:false,comment:''}]}],rows:{facts:rows},proofs:{facts:{snapshotId:'snapshot-a',expectedRows:n,pageSize:1000,pageCounts:Array.from({length:Math.ceil(n/1000)},(_,i)=>Math.min(1000,n-i*1000)),primaryKey:['id'],sha256:createHash('sha256').update(JSON.stringify(rows)).digest('hex')}}};}
test('complete snapshots beyond 10k retain precise scalars and reject gaps, duplicates, bad digest and tenant',async()=>{
 const s=snapshot();const a=validateSnapshot(s,'mengine-demo');assert.equal((await a.rows(s.tables[0])).length,12001);assert.equal(s.rows.facts[1].amount,'123456789012345678.123456');assert.equal(s.rows.facts[0].amount,null);
 for(const mutate of [(x:any)=>x.rows.facts.pop(),(x:any)=>x.rows.facts[1]=x.rows.facts[0],(x:any)=>x.proofs.facts.pageCounts.pop(),(x:any)=>x.proofs.facts.sha256='0'.repeat(64),(x:any)=>x.snapshot.readOnly=false,(x:any)=>x.tenantId='other']){const bad=structuredClone(s);mutate(bad);assert.throws(()=>validateSnapshot(bad,'mengine-demo'));}
 assert.doesNotThrow(()=>validateSnapshot(snapshot(0),'mengine-demo'));
});
test('full native pull imports every row, failed refresh preserves prior content/version',async()=>{
 const root=await mkdtemp(join(tmpdir(),'full-native-source-'));const previous=process.env.DATABASE_DEPLOYED_SOURCES;const file=join(root,'snapshot.json'),registry=join(root,'registry.json');process.env.DATABASE_DEPLOYED_SOURCES=registry;
 await writeFile(file,JSON.stringify(snapshot()));await writeFile(registry,JSON.stringify({sources:[{id:'complete',tenantId:'mengine-demo',command:[process.execPath,'-e',`process.stdout.write(require('fs').readFileSync(${JSON.stringify(file)},'utf8'))`]}]}),{mode:0o600});
 const c=await buildServer({demo:true,storage:join(root,'storage'),model:{enabled:false,apiKey:'',model:'off',baseUrl:'https://invalid.example'}});
 try{
  const login=await c.app.inject({method:'POST',url:'/api/auth/login',payload:{email:'admin@mengine.demo',password:DEMO_PASSWORD}});const headers={cookie:String(login.headers['set-cookie']).split(';')[0]};
  const post=(url:string,payload:any)=>c.app.inject({method:'POST',url,headers,payload});
  const conn=(await post('/api/database-connections',{kind:'deployed',name:'synthetic',provider:'complete'})).json();const scan=(await post(`/api/database-connections/${conn.id}/scan`,{})).json();
  const pull=await post(`/api/database-connections/${conn.id}/pull`,{table:'facts',fingerprint:scan.fingerprint,governanceMode:'deployment'});assert.equal(pull.statusCode,200,pull.body);assert.equal(pull.json().rows,12001);const id=pull.json().id;
  const before=c.store.doc('mengine-demo',id)!;const job=(await post(`/api/database-connections/${conn.id}/sync`,{datasetId:id,intervalMinutes:60})).json();
  const bad=snapshot();bad.rows.facts.pop();await writeFile(file,JSON.stringify(bad));const update=await post(`/api/database-sync/${job.id}/run`,{});assert.equal(update.statusCode,502,update.body);assert.equal(c.store.doc('mengine-demo',id)!.version,before.version);assert.equal((c.store.db.prepare('SELECT count(*) n FROM data_rows WHERE dataset_id=?').get(id) as any).n,12001);
 }finally{await c.app.close();if(previous===undefined)delete process.env.DATABASE_DEPLOYED_SOURCES;else process.env.DATABASE_DEPLOYED_SOURCES=previous;await rm(root,{recursive:true,force:true});}
});

test('restricted deployment content requires explicit content rights, including other administrators',async()=>{
 const {canReadResource,canGovernResource,canInspectQuarantinedContent,canManagePolicy}=await import('../src/domain.js');
 const owner:any={id:'owner',tenantId:'a',active:true,role:'admin',clearance:3};const other={...owner,id:'other'};const member={...owner,id:'member',role:'member',clearance:2};
 const d:any={id:'restricted',tenantId:'a',ownerId:'owner',status:'ready',classification:2,audience:'private',grants:[],restrictedContent:true};
 assert.equal(canReadResource(owner,d),true);assert.equal(canReadResource(other,d),false);assert.equal(canGovernResource(other,d),false);assert.equal(canManagePolicy(other,d),false);assert.equal(canInspectQuarantinedContent(other,{...d,status:'quarantined'}),false);assert.equal(canReadResource(member,d),false);
 assert.equal(canReadResource(member,{...d,grants:[{subjectType:'user',subjectId:'member',level:'read'}]}),true);assert.equal(canReadResource({...owner,tenantId:'other'},d),false);
 assert.equal(canReadResource(other,{...d,restrictedContent:false}),true);
});

test('restricted sources and derived knowledge never enter the shared central export',async()=>{
 const {seedDataset}=await import('./helpers/structured-fixture.js');const {deploymentContext,importDeployment}=await import('../src/deployment-governance.js');const {createHmac,randomUUID}=await import('node:crypto');
 const root=await mkdtemp(join(tmpdir(),'restricted-export-')),old=process.env.MENGINE_PLATFORM_BRIDGE_KEY,key='test-only-bridge-key-'.repeat(3);process.env.MENGINE_PLATFORM_BRIDGE_KEY=key;
 const c=await buildServer({demo:true,storage:root,model:{enabled:false,apiKey:'',model:'off',baseUrl:'https://invalid.example'}});
 try{const u=c.store.user('u-admin')!;c.store.db.prepare('INSERT INTO platform_tenant_bindings VALUES(?,?,?)').run('central',u.tenantId,u.id);
  const id=seedDataset(c.store,u,'受限工资',[{name:'id',label:'编号',type:'text',required:true,unique:true,sensitive:false,description:'编号'}],[{id:'001'}]);const d=c.store.doc(u.tenantId,id)!;d.restrictedContent=true;c.store.saveDoc(d);
  const v=deploymentContext(c.store,u,[id]).datasets[0];importDeployment(c.store,u,{contractVersion:'1.0',tenantId:u.tenantId,id:'restricted-first',producer:'synthetic',datasets:[{id,token:v.token,definition:{tableMeaning:'受限工资',usageRules:'受限',fields:[{name:'id',label:'编号',meaning:'编号',unit:'',rules:'',evidence:'合成'}],relations:[],templates:[]},fieldEvidence:[{column:'id',status:'SOURCE_DOCUMENTED',reference:'synthetic'}],knowledge:[{title:'受限知识',intro:'合成',content:'只能获权阅读',fields:['id']}]}]});
  async function get(path:string,actor='collection-worker'){const payload=Buffer.from(JSON.stringify({tenant:'central',actor,nonce:randomUUID(),at:Date.now(),method:'GET',path})).toString('base64url');const res=await c.app.inject({method:'POST',url:'/api/internal/platform-scene',payload:{payload,signature:createHmac('sha256',key).update(payload).digest('hex')}});assert.equal(res.statusCode,200,res.body);return res.json();}
  assert.ok(!(await get('/scene-export')).assets.some((a:any)=>a.id===id));assert.ok(!(await get('/scene-knowledge')).items.some((a:any)=>a.id.includes(id)));assert.ok((await get('/scene-knowledge','deployment:codex')).items.some((a:any)=>a.id.includes(id)));
 }finally{await c.app.close();if(old===undefined)delete process.env.MENGINE_PLATFORM_BRIDGE_KEY;else process.env.MENGINE_PLATFORM_BRIDGE_KEY=old;await rm(root,{recursive:true,force:true});}
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildServer} from '../src/server.js';
import {DEMO_PASSWORD} from '../src/seed.js';
import {canRead,canUseAI,canEditContent,canEditSchema,canMutateRecords,canGovernResource,canViewGovernanceMetadata,canInspectQuarantinedContent,canApprovePolicy,type User,type Doc} from '../src/domain.js';
import {Store} from '../src/store.js';
import {governanceFingerprint} from '../src/governance-ai.js';
async function fixture(fn:(c:Awaited<ReturnType<typeof buildServer>>,login:(id:string)=>Promise<{cookie:string}>)=>Promise<void>){const dir=await mkdtemp(join(tmpdir(),'enterprise-access-'));const c=await buildServer({demo:true,storage:dir});const login=async(id:string)=>{const user=c.store.user(id)!;const r=await c.app.inject({method:'POST',url:'/api/auth/login',payload:{email:user.email,password:DEMO_PASSWORD}});assert.equal(r.statusCode,200,r.body);return {cookie:String(r.headers['set-cookie']).split(';')[0]};};try{await fn(c,login);}finally{await c.app.close();await rm(dir,{recursive:true,force:true});}}
const source=(c:Awaited<ReturnType<typeof buildServer>>)=>c.store.documents('mengine-demo').find(d=>d.status==='ready'&&d.kind!=='数据表')!;
const proposal=(d:Doc,patch:Record<string,unknown>={audience:'organization'})=>({documentId:d.id,action:'permissions',patch,reason:'企业权限验收',documentVersion:d.version,policyVersion:d.policyVersion});
test('all roles are content/schema/record readonly; tenant, clearance and state gates precede admin exceptions',()=>fixture(async(c)=>{
 const d={...source(c),audience:'private' as const,classification:3,ownerId:'unrelated',grants:[]};
 for(const role of ['admin','steward','manager','member','auditor'] as const){const u={...c.store.user('u-admin')!,role,clearance:0};assert.equal(canEditContent(u,d),false);assert.equal(canEditSchema(u,d),false);assert.equal(canMutateRecords(u,d),false);assert.equal(canRead(u,d),role==='admin');assert.equal(canRead({...u,tenantId:'outside'},d),false);assert.equal(canRead({...u,active:false},d),false);assert.equal(canRead(u,{...d,status:'quarantined'}),false);assert.equal(canRead(u,{...d,status:'archived'}),false);assert.equal(canUseAI(u,{...d,aiPaused:true}),false);}
 const member={...c.store.user('u-admin')!,role:'member' as const,clearance:1};assert.equal(canRead(member,{...d,ownerId:member.id,grants:[{subjectType:'user',subjectId:member.id,level:'read'}]}),false);
}));
test('governance metadata and isolated content inspection are separate capabilities',()=>fixture(async(c)=>{
 const d={...source(c),audience:'private' as const,ownerId:'other',classification:2,grants:[]};const u={...c.store.user('u-admin')!,role:'steward' as const,clearance:1,duties:{governance:[{type:'resource' as const,id:d.id}]}};
 assert.equal(canViewGovernanceMetadata(u,d),true);assert.equal(canGovernResource(u,d),false);assert.equal(canRead(u,d),false);assert.equal(canInspectQuarantinedContent({...u,clearance:3},{...d,status:'quarantined'}),false);assert.equal(canInspectQuarantinedContent({...u,clearance:3,duties:{inspection:[{type:'resource',id:d.id}]}},{...d,status:'quarantined'}),true);
}));
test('administrator applies read policy immediately with audit and version conflicts',()=>fixture(async(c,login)=>{
 const h=await login('u-admin'),d=source(c),before=c.store.proposals(d.tenantId).length;
 let r=await c.app.inject({method:'POST',url:'/api/scene-access/policy',headers:h,payload:proposal(d)});assert.equal(r.statusCode,200,r.body);assert.equal(r.json().direct,true);assert.equal(c.store.proposals(d.tenantId).length,before);assert.equal(c.store.doc(d.tenantId,d.id)!.policyVersion,d.policyVersion+1);assert.ok(c.store.auditValid(d.tenantId));
 r=await c.app.inject({method:'POST',url:'/api/scene-access/policy',headers:h,payload:proposal(d)});assert.equal(r.statusCode,409);
 const current=c.store.doc(d.tenantId,d.id)!;r=await c.app.inject({method:'POST',url:'/api/scene-access/policy',headers:h,payload:proposal(current,{grants:[{subjectType:'user',subjectId:'u-admin',level:'edit'}]})});assert.equal(r.statusCode,400);
}));
test('non-admin application does not apply permissions; scoped steward cannot self approve; admin can approve own old request',()=>fixture(async(c,login)=>{
 const d=source(c),admin=c.store.user('u-admin')!,other=c.store.users(admin.tenantId).find(u=>u.role==='steward')!;
 other.duties={approval:[{type:'resource',id:d.id}],governance:[{type:'resource',id:d.id}]};c.store.saveUser(other);
 const h=await login(other.id);let r=await c.app.inject({method:'POST',url:'/api/proposals',headers:h,payload:proposal(d)});assert.equal(r.statusCode,200,r.body);const p=r.json();assert.equal(p.status,'pending');assert.equal(c.store.doc(d.tenantId,d.id)!.policyVersion,d.policyVersion);
 r=await c.app.inject({method:'POST',url:`/api/proposals/${p.id}/resolve`,headers:h,payload:{decision:'approve'}});assert.equal(r.statusCode,403);
 other.role='admin';c.store.saveUser(other);r=await c.app.inject({method:'POST',url:`/api/proposals/${p.id}/resolve`,headers:await login(other.id),payload:{decision:'approve'}});assert.equal(r.statusCode,200,r.body);assert.equal(r.json().proposal.status,'applied');
}));
test('approval revalidates grantee status and stale versions; visible badge equals pending list',()=>fixture(async(c,login)=>{
 const d=source(c),member=c.store.users(d.tenantId).find(u=>u.role==='member')!,target=c.store.users(d.tenantId).find(u=>u.role==='manager')!;
 const h=await login(member.id);let r=await c.app.inject({method:'POST',url:'/api/proposals',headers:h,payload:proposal(d,{grants:[{subjectType:'user',subjectId:target.id,level:'read'}]})});assert.equal(r.statusCode,200,r.body);const p=r.json();target.active=false;c.store.saveUser(target);
 r=await c.app.inject({method:'POST',url:`/api/proposals/${p.id}/resolve`,headers:await login('u-admin'),payload:{decision:'approve'}});assert.equal(r.statusCode,400);
 const current=c.store.doc(d.tenantId,d.id)!;current.policyVersion++;c.store.saveDoc(current);
 r=await c.app.inject({method:'POST',url:`/api/proposals/${p.id}/resolve`,headers:await login('u-admin'),payload:{decision:'approve'}});assert.equal(r.statusCode,409);assert.equal(c.store.proposals(d.tenantId).find(x=>x.id===p.id)!.status,'invalidated');
 r=await c.app.inject({url:'/api/scene-access',headers:h});assert.equal(r.statusCode,200);assert.equal(r.json().pending,r.json().proposals.filter((p:any)=>p.status==='pending').length);
}));
test('legacy editing API cannot write even as admin; ordinary quarantined reads are hidden',()=>fixture(async(c,login)=>{
 const d=source(c),h=await login('u-admin'),before=d.content;
 for(const patch of [{title:'改标题'},{content:'改正文'},{tags:['改标签']}]){const r=await c.app.inject({method:'PATCH',url:`/api/documents/${d.id}`,headers:h,payload:{...patch,expectedVersion:d.version}});assert.equal(r.statusCode,403,r.body);}assert.equal(c.store.doc(d.tenantId,d.id)!.content,before);
 d.status='quarantined';c.store.saveDoc(d);const r=await c.app.inject({url:`/api/documents/${d.id}`,headers:h});assert.equal(r.statusCode,404);
 const inspected=await c.app.inject({method:'POST',url:`/api/scene-access/resources/${d.id}/inspect`,headers:h,payload:{reason:'独立隔离检查'}});assert.equal(inspected.statusCode,200);assert.equal(inspected.json().inspectionOnly,true);assert.ok(c.store.auditValid(d.tenantId));
}));
test('department rename keeps stable membership and grants; referenced department cannot be removed',()=>fixture(async(c,login)=>{
 const d=source(c),u=c.store.users(d.tenantId).find(u=>u.role==='member')!,h=await login('u-admin');d.audience='private';d.ownerId='other';d.classification=0;d.department=u.department;d.departmentId=u.departmentId;d.grants=[{subjectType:'department',subjectId:u.departmentId!,level:'read'}];c.store.saveDoc(d);const fingerprint=governanceFingerprint(d);assert.ok(canRead(u,d));
 let r=await c.app.inject({method:'POST',url:'/api/scene-access/departments',headers:h,payload:{id:u.departmentId,name:'验收部门新名称'}});assert.equal(r.statusCode,200,r.body);assert.equal(c.store.user(u.id)!.departmentId,u.departmentId);assert.ok(canRead(c.store.user(u.id)!,c.store.doc(d.tenantId,d.id)!));assert.equal(governanceFingerprint(c.store.doc(d.tenantId,d.id)!),fingerprint);
 r=await c.app.inject({method:'POST',url:'/api/scene-access/departments',headers:h,payload:{id:u.departmentId,remove:true}});assert.equal(r.statusCode,409);
}));
test('auditor cannot write policies directly, govern, ingest, or configure organization; last admin protected',()=>fixture(async(c,login)=>{
 const u=c.store.users('mengine-demo').find(u=>u.role==='auditor')!,h=await login(u.id),d=source(c);assert.equal(canGovernResource(u,d),false);assert.equal(canApprovePolicy(u,d),false);
 for(const url of ['/api/documents','/api/governance/scan','/api/scene-access/departments']){const r=await c.app.inject({method:'POST',url,headers:h,payload:{name:'不应创建'}});assert.equal(r.statusCode,403,r.body);}
 const a=c.store.user('u-admin')!;assert.throws(()=>c.store.saveUser({...a,active:false}),/最后一位/);
}));
test('legacy grant migration preserves content, downgrades edit and invalidates old proposals without granting duties',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'policy-migration-')),path=join(dir,'db');let s=new Store(path);try{
 s.db.prepare('INSERT INTO tenants VALUES(?,?,?)').run('t','迁移企业',new Date().toISOString());const u:User={id:'u',tenantId:'t',name:'管理员',email:'u@test.invalid',department:'旧部门',role:'admin',clearance:1,active:true};s.addUser(u,'test-password');
 const d={id:'d',tenantId:'t',title:'旧文',department:'旧部门',ownerId:'u',classification:1,audience:'private',status:'ready',grants:[{subjectType:'department',subjectId:'旧部门',level:'edit'}],content:'保留内容',tags:[],version:1,policyVersion:1,sha:'unique',kind:'txt',summary:'',originalPath:'',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),reviewAt:'2030-01-01',quality:100,issues:[],error:null} as Doc;s.saveDoc(d);s.proposal({id:'p',tenantId:'t',documentId:'d',authorId:'u',action:'summary',patch:{summary:'旧变更'},reason:'旧',documentVersion:1,policyVersion:1,status:'pending',createdAt:new Date().toISOString()});s.db.prepare('DELETE FROM access_migrations').run();s.close();s=new Store(path);
 assert.equal(s.doc('t','d')!.content,'保留内容');assert.equal(s.doc('t','d')!.grants[0].level,'read');assert.equal(s.user('u')!.clearance,3);assert.deepEqual(s.user('u')!.duties,{});assert.equal(s.proposals('t')[0].status,'invalidated');assert.ok(s.auditValid('t'));
 }finally{s.close();await rm(dir,{recursive:true,force:true});}
});
test('enterprise knowledge reads are available to authorized ordinary members, not restricted to governors',()=>fixture(async(c,login)=>{
 const member=c.store.users('mengine-demo').find(u=>u.role==='member')!;
 const r=await c.app.inject({url:'/api/scene-knowledge',headers:await login(member.id)});assert.equal(r.statusCode,200,r.body);
}));
test('approval and inspection scopes work independently of governance and ordinary reading',()=>fixture(async(c,login)=>{
 const d=source(c),steward=c.store.users(d.tenantId).find(u=>u.role==='steward')!,member=c.store.users(d.tenantId).find(u=>u.role==='member')!;
 d.audience='private';d.ownerId='other';d.classification=0;d.grants=[];c.store.saveDoc(d);steward.duties={approval:[{type:'resource',id:d.id}],inspection:[{type:'resource',id:d.id}]};c.store.saveUser(steward);
 const p=await c.app.inject({method:'POST',url:'/api/proposals',headers:await login(member.id),payload:proposal(d)});assert.equal(p.statusCode,200,p.body);
 const h=await login(steward.id);let r=await c.app.inject({url:'/api/scene-access',headers:h});assert.ok(r.json().proposals.some((x:any)=>x.id===p.json().id&&x.canApprove));
 d.status='quarantined';c.store.saveDoc(d);r=await c.app.inject({url:'/api/scene-access',headers:h});const resource=r.json().resources.find((x:any)=>x.id===d.id);assert.equal(resource.canInspect,true);assert.equal(resource.canRead,false);assert.equal(resource.canGovern,false);
}));

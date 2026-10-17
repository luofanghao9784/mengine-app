import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../src/server.js';
import { DEMO_PASSWORD } from '../src/seed.js';
import { Store } from '../src/store.js';
async function fixture(run: (ctx: Awaited<ReturnType<typeof buildServer>>, login: (name: string) => Promise<{ cookie: string }>) => Promise<void>) {
 const dir=await mkdtemp(join(tmpdir(),'mengine-departments-')),ctx=await buildServer({demo:true,storage:dir});
 const login=async(name:string)=>{const r=await ctx.app.inject({method:'POST',url:'/api/auth/login',payload:{email:`${name}@mengine.demo`,password:DEMO_PASSWORD}});assert.equal(r.statusCode,200);return {cookie:String(r.headers['set-cookie']).split(';')[0]};};
 try {await run(ctx,login);} finally {await ctx.app.close();await rm(dir,{recursive:true,force:true});}
}
test('自定义部门按企业隔离，管理员新增后成员可使用，拒绝未知部门',()=>fixture(async({app,store},login)=>{
 const headers=await login('admin');
 assert.equal((await app.inject({method:'POST',url:'/api/departments',headers,payload:{name:'供应链中心'}})).statusCode,200);
 assert.ok((await app.inject({url:'/api/me',headers})).json().departments.includes('供应链中心'));
 assert.ok(!(await app.inject({url:'/api/me',headers:await login('external')})).json().departments.includes('供应链中心'));
 const patch={role:'member',clearance:1,active:true,department:'供应链中心'};
 assert.equal((await app.inject({method:'PATCH',url:'/api/members/u-engineer',headers,payload:patch})).statusCode,200);
 assert.equal((await app.inject({method:'PATCH',url:'/api/members/u-engineer',headers,payload:{...patch,department:'未创建的部门'}})).statusCode,400);
 assert.equal((await app.inject({method:'POST',url:'/api/scene-access/departments',payload:{id:store.departmentId('mengine-demo','供应链中心'),remove:true},headers})).statusCode,409);
}));
test('部门写操作验证管理员、重复名称和空名称，删除仅限无引用部门',()=>fixture(async({app,store},login)=>{
 const admin=await login('admin'),steward=await login('steward');
 assert.equal((await app.inject({method:'POST',url:'/api/departments',headers:steward,payload:{name:'实验中心'}})).statusCode,403);
 assert.equal((await app.inject({method:'POST',url:'/api/departments',headers:admin,payload:{name:'  '}})).statusCode,400);
 assert.equal((await app.inject({method:'POST',url:'/api/departments',headers:admin,payload:{name:'实验中心'}})).statusCode,200);
 assert.equal((await app.inject({method:'POST',url:'/api/departments',headers:admin,payload:{name:'实验中心'}})).statusCode,409);
 const d=store.doc('mengine-demo','doc-1')!;d.grants.push({subjectType:'department',subjectId:store.departmentId('mengine-demo','实验中心')!,level:'read'});store.saveDoc(d);
 assert.equal((await app.inject({method:'POST',url:'/api/scene-access/departments',payload:{id:store.departmentId('mengine-demo','实验中心'),remove:true},headers:admin})).statusCode,409);
 d.grants=[];store.saveDoc(d);
 assert.equal((await app.inject({method:'POST',url:'/api/scene-access/departments',payload:{id:store.departmentId('mengine-demo','实验中心'),remove:true},headers:admin})).statusCode,200);
 assert.ok(store.auditValid('mengine-demo'));
}));
test('部门目录持久化，现有部门自动迁移且不引入写死的默认部门',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mengine-dept-store-')),file=join(dir,'test.db');
 let store=new Store(file);store.ensureDepartment('tenant-a','独立事业部');store.close();
 store=new Store(file);assert.deepEqual(store.departments('tenant-a'),['独立事业部']);assert.deepEqual(store.departments('tenant-b'),[]);assert.equal(store.db.pragma('user_version',{simple:true}),10);store.close();await rm(dir,{recursive:true,force:true});
});

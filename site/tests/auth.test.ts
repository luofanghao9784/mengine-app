import test from 'node:test';
import assert from 'node:assert/strict';
const id='00000000-0000-4000-8000-000000000001';
const identity=(admin=false,platform=false)=>({account:{id,phone:'+8613800000000',email:null,displayName:'合成账号'},platformAdmin:platform,memberships:[{tenantId:id,tenantName:'合成企业',role:admin?'TENANT_ADMIN':'MEMBER'}]});
let calls: {path:string;init:RequestInit}[]=[];
let handle:(path:string,body:any)=>unknown=()=>identity();
globalThis.fetch=async(input,init={})=>{
 const path=String(input);calls.push({path,init});
 assert.equal(init.credentials,'same-origin');assert.equal(init.redirect,'error');
 if(path.endsWith('/csrf'))return Response.json({token:'synthetic-csrf',headerName:'X-CSRF-TOKEN'});
 assert.equal((init.headers as Record<string,string>)['X-CSRF-TOKEN'],'synthetic-csrf');
 const result=handle(path,JSON.parse(String(init.body)));
 return result instanceof Response?result:result===null?new Response(null,{status:204}):Response.json(result);
};
Object.defineProperty(globalThis,'location',{value:{origin:'https://ai.9pop.top',pathname:'/login/index.html',hash:''}});
const auth=await import('../src/login/auth.ts');
const setup=(fn:typeof handle)=>{calls=[];handle=fn;};
test('customer uses normalized phone, CSRF, cookies and fixed workspace redirect',async()=>{
 setup((path,body)=>{assert.equal(path,'/api/v1/auth/login');assert.deepEqual(body,{phone:'+8613800000000',password:'synthetic'});return identity();});
 assert.deepEqual(await auth.signIn({surface:'workspace',phone:'138 0000-0000',password:'synthetic'}),{ok:true,redirect:'/workspace/'});
});
test('admin redirects only when membership permits; member is not promoted',async()=>{
 setup(()=>identity(true));assert.deepEqual(await auth.signIn({surface:'admin',phone:'+8613800000000',password:'synthetic'}),{ok:true,redirect:'/tenant-admin/'});
 setup(()=>identity());assert.equal((await auth.signIn({surface:'admin',phone:'+8613800000000',password:'synthetic'})).ok,false);
});
test('platform uses independent username endpoint and csrf realm',async()=>{
 setup((p,b)=>{assert.equal(p,'/api/platform-admin/v1/auth/login');assert.deepEqual(b,{username:'operator',password:'synthetic'});return identity(false,true);});
 assert.deepEqual(await auth.signIn({surface:'platform',account:' operator ',password:'synthetic'}),{ok:true,redirect:'/platform-admin/'});
 assert.equal(calls[0].path,'/api/platform-admin/v1/auth/csrf');
});
test('credential and network errors become safe page messages',async()=>{
 setup(()=>Response.json({contractVersion:'1.0',code:'INVALID_CREDENTIALS'},{status:401}));
 const bad=await auth.signIn({surface:'platform',account:'x',password:'synthetic'});assert.equal(bad.ok,false);assert.match(bad.message!,/密码/);
 setup(()=>{throw new Error('sensitive transport detail');});
 assert.equal(JSON.stringify(await auth.signIn({surface:'platform',account:'x',password:'synthetic'})).includes('sensitive'),false);
});
test('malformed successful response is not treated as authentication',async()=>{
 setup(()=>({redirect:'https://evil.test',account:{}}));assert.equal((await auth.signIn({surface:'workspace',phone:'13800000000',password:'synthetic'})).ok,false);
});
test('disabled SMS surfaces existing backend error without false success',async()=>{
 setup(()=>Response.json({contractVersion:'1.0',code:'SMS_UNAVAILABLE'},{status:503}));
 const r=await auth.requestResetCode('13800000000');assert.equal(r.ok,false);assert.match(r.message!,/短信/);
});
test('reset retains challenge only for its phone and does not claim SMS delivery',async()=>{
 setup((p,b)=>{assert.equal(b.purpose,'RESET');return {id,expiresAt:new Date(Date.now()+60000).toISOString(),retryAfterSeconds:60,delivery:'LOCAL',localPreview:false};});
 const r=await auth.requestResetCode('13800000000');assert.equal(r.ok,true);assert.match(r.message!,/尚未发送短信/);
 calls=[];assert.equal((await auth.resetPassword('13900000000','123456','synthetic')).ok,false);assert.equal(calls.length,0);
 setup((p,b)=>{assert.equal(p,'/api/v1/auth/phone/reset');assert.equal(b.challengeId,id);assert.equal(b.phone,'+8613800000000');return null;});
 assert.equal((await auth.resetPassword('13800000000','123456','synthetic')).ok,true);
 calls=[];assert.equal((await auth.resetPassword('13800000000','123456','synthetic')).ok,false);assert.equal(calls.length,0);
});
test('invitation verifies token and hands off hashed server context without token in URL',async()=>{
 const token='a'.repeat(43);
 setup((p,b)=>{assert.equal(p,'/api/v1/auth/phone/invitation');assert.equal(b.token,token);return {tenantId:id,tenantName:'合成',phone:'+8613800000000',maskedPhone:'+8613****0000',status:'PENDING',action:'CREATE',designatedOwner:false};});
 assert.deepEqual(await auth.readInvitation('https://ai.9pop.top/workspace/#invite='+token),{ok:true,redirect:'/workspace/#invite'});
});
test('foreign links, URL credentials and bad tokens never cause requests',async()=>{
 setup(()=>{throw Error('must not request');});
 for(const value of ['https://evil.test/workspace/#invite='+'a'.repeat(43),'https://x@ai.9pop.top/workspace/#invite='+'a'.repeat(43),'bad'])assert.equal((await auth.readInvitation(value)).ok,false);
 assert.equal(calls.length,0);
});

test("common website login requests surface selection; dedicated login clears it",async()=>{
 const { pendingSurfaceChoice, clearSurfaceChoice }=await import("../../src/identity/surface-choice.ts");
 clearSurfaceChoice();setup(()=>identity(true,true));
 await auth.signIn({surface:"workspace",phone:"13800000000",password:"synthetic"});
 assert.equal(pendingSurfaceChoice(),true);
 await auth.signIn({surface:"platform",account:"operator",password:"synthetic"});
 assert.equal(pendingSurfaceChoice(),false);
});

test('provisioned username uses the customer endpoint and keeps admin role checks',async()=>{
 setup((path,body)=>{assert.equal(path,'/api/v1/auth/login');assert.deepEqual(body,{username:'meizu',password:'synthetic'});return {...identity(true),account:{id,phone:null,email:null,username:'meizu',displayName:'合成'}};});
 assert.deepEqual(await auth.signIn({surface:'admin',phone:' meizu ',password:'synthetic'}),{ok:true,redirect:'/tenant-admin/'});
});

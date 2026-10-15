import fs from 'node:fs/promises';import assert from 'node:assert/strict';
// Existing local acceptance identities only; this test never creates or changes credentials.
const accounts=JSON.parse(await fs.readFile(process.argv[2] || '.local/scene-test-accounts.json'));
const origin=process.env.SCENE_TEST_ORIGIN || 'http://127.0.0.1:5173';
async function session(a){const cookies=new Map();async function call(path,body){const headers={Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; ')};if(body!==undefined){const c=await call('/api/v1/auth/csrf');headers[c.data.headerName]=c.data.token;headers.Cookie=[...cookies].map(([k,v])=>k+'='+v).join('; ');headers['Content-Type']='application/json';}const r=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers,...(body===undefined?{}:{body:JSON.stringify(body)})});for(const c of r.headers.getSetCookie()){const [k,...v]=c.split(';')[0].split('=');cookies.set(k,v.join('='));}return {status:r.status,data:await r.json()};}const login=await call('/api/v1/auth/login',{phone:a.phone,password:a.password});assert.equal(login.status,200,JSON.stringify(login.data));return call;}
const a=await session(accounts.a),b=await session(accounts.b),base='/api/tenant-admin/v1/tenants/';
let r=await a(base+accounts.a.tenant+'/scene/dispatch?path=%2Fscene-foundation');console.log('A foundation',r.status,r.data.items?.length,r.data.code);assert.equal(r.status,200);
r=await b(base+accounts.a.tenant+'/scene/dispatch?path=%2Fscene-foundation');console.log('B cannot read A',r.status);assert.equal(r.status,403);
r=await b(base+accounts.b.tenant+'/scene/dispatch?path=%2Fscene-foundation');console.log('B has no fallback source',r.status);assert.equal(r.status,404);
r=await a(base+accounts.a.tenant+'/scene/synchronize',{});console.log('Synchronize',r.status,r.data.assets?.length,r.data.code);assert.equal(r.status,200,JSON.stringify(r.data));
console.log('tenant isolation and input synchronization verified');

const identity=r.data.assets.map(x=>[x.kind,x.source_id,x.target_id,x.revision]);
const again=await a(base+accounts.a.tenant+'/scene/synchronize',{});
assert.equal(again.status,200);assert.deepEqual(again.data.assets.map(x=>[x.kind,x.source_id,x.target_id,x.revision]),identity);
assert.ok(again.data.assets.some(x=>x.kind==='TABLE' && x.metadata.tags.length && x.metadata.dictionary));
console.log('repeat synchronization preserves identities, versions, tags and business definitions');

r=await b(base+accounts.a.tenant+'/scene/synchronize',{});assert.equal(r.status,403);
r=await a(base+accounts.a.tenant+'/scene/dispatch?path=%2Fscene-knowledge%2Fsync',{retry:false});assert.equal(r.status,200,JSON.stringify(r.data));console.log('processing dispatch and cross-enterprise write rejection verified');

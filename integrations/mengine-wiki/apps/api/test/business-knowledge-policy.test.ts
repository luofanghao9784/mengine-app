import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildServer} from '../src/server.js';
import {seedDataset} from './helpers/structured-fixture.js';
import {dictionaryFingerprint} from '../src/dictionary-version.js';
import {createBusinessKnowledge} from '../src/business-knowledge.js';
async function fixture(fn:(c:any)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'knowledge-policy-'));
 const c=await buildServer({demo:true,storage:root,model:{apiKey:'synthetic-only',baseUrl:'https://example.test/v1',model:'synthetic'}});
 try{
  const user=c.store.user('u-admin')!;
  const fields=[{name:'amount',label:'金额',type:'number' as const,required:false,unique:false,sensitive:false,description:'合成测试'}];
  const id=seedDataset(c.store,user,'合成订单',fields,[{amount:'10'},{amount:'20'}]);
  const raw=JSON.parse((c.store.db.prepare('SELECT data FROM data_sets WHERE id=?').get(id) as any).data);
  c.store.db.prepare('INSERT INTO data_dictionary VALUES(?,?,?)').run(id,user.tenantId,JSON.stringify({confirmed:{origin:'model',fingerprint:dictionaryFingerprint(c.store,user.tenantId,raw),definition:{tableMeaning:'合成订单',usageRules:'仅测试',fields:fields.map(f=>({...f,meaning:'测试金额',unit:'元',rules:'',evidence:'测试'})),relations:[]}}}));
  const knowledge=createBusinessKnowledge(c.store,c.model);
  await fn({...c,user,id,knowledge});
 }finally{await c.app.close();await rm(root,{recursive:true,force:true});}
}
test('business knowledge accepts numbers not literally present in cited facts',()=>fixture(async c=>{
 c.model.complete=async()=>({text:JSON.stringify({articles:[{title:'金额观察',intro:'合成计算描述',content:'合成金额为999999元。',evidence:['F2']}],reason:''})});
 assert.deepEqual(await c.knowledge.learn(c.user,c.id,()=>c.user),{learned:1});
 assert.equal(c.knowledge.snapshot(c.user).items.find((x:any)=>x.sourceId===c.id).content,'合成金额为999999元。');
}));
test('unknown evidence is still rejected without numeric gate',()=>fixture(async c=>{
 c.model.complete=async()=>({text:JSON.stringify({articles:[{title:'金额观察',intro:'合成测试',content:'合成金额为999999元。',evidence:['UNKNOWN']}],reason:''})});
 await assert.rejects(c.knowledge.learn(c.user,c.id,()=>c.user),/缺少真实数据依据/);
 assert.equal(c.knowledge.snapshot(c.user).items.filter((x:any)=>x.sourceId===c.id).length,0);
}));
test('permission revocation during generation still prevents publication',()=>fixture(async c=>{
 c.model.complete=async()=>{const d=c.store.doc(c.user.tenantId,c.id)!;d.aiPaused=true;c.store.saveDoc(d);return {text:JSON.stringify({articles:[{title:'金额观察',intro:'合成测试',content:'合成金额为999999元。',evidence:['F2']}],reason:''})};};
 await assert.rejects(c.knowledge.learn(c.user,c.id,()=>c.user),(e:any)=>e.statusCode===409);
 assert.equal(c.knowledge.snapshot(c.user).items.filter((x:any)=>x.sourceId===c.id).length,0);
}));

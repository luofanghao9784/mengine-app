import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
const spec=JSON.parse(await readFile(new URL('../../contracts/public-api/source.openapi.json',import.meta.url),'utf8'));
const ajv=new Ajv2020({strict:false,formats:{uuid:true,date:true,'date-time':true}});
const id='00000000-0000-4000-8000-000000000001';
const schema=name=>ajv.compile({...spec.components.schemas[name],components:spec.components});
test('source writes bind an authorized workspace, immutable versions, revision and idempotency',()=>{
  for(const path of Object.values(spec.paths))if(path.post){
    assert.ok(path.parameters.some(p=>p.name==='tenant'&&p.required));
    assert.ok(path.parameters.some(p=>p.name==='workspace'&&p.required));
    assert.ok(path.post.parameters.some(p=>p.name==='X-CSRF-TOKEN'&&p.required));
  }
  const submit=schema('Submit');
  const request={requestId:id,coverageFrom:'2026-09-01',coverageThrough:'2026-09-30',note:'仅为人工声明',versionIds:[id]};
  assert.ok(submit(request));
  assert.equal(submit({...request,actorId:id}),false);
  assert.equal(submit({...request,versionIds:[id,id]}),false);
  assert.equal(submit({...request,versionIds:[]}),false);
  assert.equal(submit({...request,sourceUrl:'https://private.example'}),false);
  const edit=schema('Edit');
  assert.equal(edit({requestId:id}),false);
});
test('declared coverage stays distinct from parsing, business verification and effective configuration history',()=>{
  for(const name of Object.keys(spec.components.schemas))assert.doesNotThrow(()=>schema(name));
  const record={name:'月报',description:'人工补交',responsibleId:id,cadenceHours:24,expectedFrom:'2026-09-01',expectedThrough:'2026-09-30',status:'ACTIVE',id,tenantId:id,workspaceId:id,revision:0,coverageState:'DECLARED',lastSubmittedAt:null,dueAt:null,overdue:false,canMaintain:true,updatedAt:'2026-10-01T00:00:00Z'};
  const source=schema('Source');
  assert.ok(source(record));
  for(const value of ['VERIFIED','COMPLETE','MODEL_SUCCEEDED'])assert.equal(source({...record,coverageState:value}),false);
  assert.ok(spec.paths['/api/v1/tenants/{tenant}/workspaces/{workspace}/sources/{source}/versions'].get);
});

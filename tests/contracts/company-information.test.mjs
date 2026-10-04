import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import Ajv2020 from 'ajv/dist/2020.js';
const spec=JSON.parse(await readFile(new URL('../../contracts/public-api/profile.openapi.json',import.meta.url),'utf8'));
const ajv=new Ajv2020({strict:false,formats:{uuid:true,'date-time':true}}),id='00000000-0000-4000-8000-000000000001';
test('company changes cannot claim AI origin or bypass current group version',()=>{
 const check=ajv.compile({...spec.components.schemas.CompanyChange,components:spec.components});const body={requestId:id,field:'NAME',expectedRevision:0,action:'ADD',tagId:null,label:'示例企业',meaning:''};assert.ok(check(body));
 for(const key of ['origin','humanProtected','tenantId','canMaintain'])assert.equal(check({...body,[key]:'AI'}),false);
 const missing={...body};delete missing.expectedRevision;assert.equal(check(missing),false);assert.equal(check({...body,field:'GOAL'}),false);
 assert.ok(spec.paths['/api/v1/tenants/{tenant}/company-information'].post.parameters.some(p=>p.name==='X-CSRF-TOKEN'&&p.required));
});
test('company suggestion choices require both revisions and never accept candidate content',()=>{
 const check=ajv.compile({...spec.components.schemas.CompanyDecision,components:spec.components});const body={requestId:id,expectedRevision:1,expectedGroupRevision:0,action:'KEEP'};assert.ok(check(body));
 for(const key of ['expectedRevision','expectedGroupRevision']){const missing={...body};delete missing[key];assert.equal(check(missing),false);}
 assert.equal(check({...body,label:'overwrite'}),false);assert.equal(check({...body,action:'APPROVE'}),false);
 const evidence=ajv.compile({...spec.components.schemas.CompanySuggestionEvidence,components:spec.components});assert.equal(evidence({chunkId:id,versionId:id,filename:'source',locator:'p1',quote:''}),false);
});

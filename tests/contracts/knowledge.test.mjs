import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
const spec=JSON.parse(await readFile(new URL('../../contracts/public-api/knowledge.openapi.json',import.meta.url),'utf8'));
const ajv=new Ajv2020({strict:false,formats:{uuid:true}});
const validate=ajv.compile({...spec.components.schemas.Chunk,components:spec.components});
const id='00000000-0000-4000-8000-000000000001';
test('knowledge citations keep platform version and run identity without provider URLs',()=>{
 const chunk={id,tenantId:id,workspaceId:id,materialId:id,versionId:id,runId:id,version:1,filename:'file.md',locator:'第 1 行',method:'TEXT',content:'synthetic'};
 assert.ok(validate(chunk));
 for(const key of ['objectId','providerUrl','knowledge_id'])assert.equal(validate({...chunk,[key]:id}),false);
 for(const key of ['versionId','runId','tenantId']){const missing={...chunk};delete missing[key];assert.equal(validate(missing),false);}
});
test('parse requests require CSRF, an idempotency key and the current generation',()=>{
 const parse=Object.values(spec.paths).find(p=>p.post).post;
 assert.ok(parse.parameters.some(p=>p.in==='header' && p.name==='X-CSRF-TOKEN' && p.required));
 const check=ajv.compile(parse.requestBody.content['application/json'].schema);
 assert.ok(check({requestId:id,expectedGeneration:0}));assert.equal(check({requestId:id}),false);assert.equal(check({requestId:id,expectedGeneration:-1}),false);
});
test('coverage reports bounded authorized-scope evidence independently of query matches',()=>{
 const check=ajv.compile({...spec.components.schemas.Results,components:spec.components});
 const version={materialId:id,versionId:id,version:2,runId:id,generation:1,status:'QUEUED',warnings:[],pinned:false};
 const coverage={scope:'AUTHORIZED_WORKSPACE',status:'NOT_READY',totalVersions:1,searchableVersions:0,partialVersions:0,notReadyVersions:1,relevance:'NOT_ASSESSED',versions:[version],hasMore:false};
 const result={tenantId:id,workspaceId:id,query:'query',items:[],hasMore:false,matchStatus:'NO_MATCH',coverage};
 assert.ok(check(result),JSON.stringify(check.errors));
 assert.equal(check({...result,coverage:{...coverage,unauthorizedVersions:4}}),false);
 assert.equal(check({...result,coverage:{...coverage,versions:[{...version,warnings:['x'.repeat(65)]}]}}),false);
 assert.equal(check({...result,coverage:{...coverage,relevance:'KNOWN_RELEVANT'}}),false);
});
test('internal search callback keeps old item fields and bounds coverage separately',async()=>{
 const schema=JSON.parse(await readFile(new URL('../../contracts/engine-api/search-access.schema.json',import.meta.url),'utf8'));
 const check=ajv.compile(schema);
 const coverage={scope:'AUTHORIZED_WORKSPACE',status:'EMPTY',totalVersions:0,searchableVersions:0,partialVersions:0,notReadyVersions:0,relevance:'NOT_ASSESSED',versions:[],hasMore:false};
 assert.ok(check({items:[],matchStatus:'NO_MATCH',coverage,hasMore:false}));
 assert.equal(check({items:[],matchStatus:'NO_MATCH',coverage,hasMore:false,attemptId:id}),false);
});

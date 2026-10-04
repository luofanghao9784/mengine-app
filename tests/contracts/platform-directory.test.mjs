import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
const spec=JSON.parse(readFileSync(new URL('../../contracts/public-api/platform-directory.openapi.json',import.meta.url),'utf8'));
const schema=name=>new Ajv2020({strict:false,formats:{uuid:true,'date-time':true,email:true}}).compile(spec.components.schemas[name]);
test('account safety writes require version, deduplication key and bounded reason',()=>{
 const valid=schema('AccountStatus'), body={requestId:'00000000-0000-4000-8000-000000000001',expectedVersion:0,status:'DISABLED',reason:'合成安全处置'};
 assert.ok(valid(body));assert.equal(valid({...body,reason:''}),false);assert.equal(valid({...body,expectedVersion:-1}),false);assert.equal(valid({...body,password:'forbidden'}),false);
});
test('directory metadata excludes credentials and content and all routes require platform identity',()=>{
 const valid=schema('CustomerAccount'), body={id:'00000000-0000-4000-8000-000000000001',displayName:'合成',phone:null,email:'synthetic@example.test',status:'ACTIVE',version:0,tenantCount:1};
 assert.ok(valid(body));for(const key of ['passwordHash','conversation','workspaceContent'])assert.equal(valid({...body,[key]:'not allowed'}),false);
 for(const verbs of Object.values(spec.paths))for(const operation of Object.values(verbs))assert.deepEqual(operation.security,[{platformSessionCookie:[]}]);
});

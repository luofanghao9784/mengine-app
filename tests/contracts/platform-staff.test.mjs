import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
const spec=JSON.parse(readFileSync(new URL('../../contracts/public-api/platform-staff.openapi.json',import.meta.url),'utf8'));
const schema=name=>new Ajv2020({strict:false,formats:{uuid:true,'date-time':true}}).compile(spec.components.schemas[name]);
test('staff invitations require independent credentials and never accept requested permissions or tenant identities',()=>{
 const valid=schema('Accept'),body={token:'S'.repeat(43),username:'+8619900000001',password:'synthetic-only-password',displayName:'合成人员'};
 assert.ok(valid(body));assert.equal(valid({...body,token:'short'}),false);assert.equal(valid({...body,password:'123'}),false);
 for(const field of ['tenantId','customerAccountId','role','permissions'])assert.equal(valid({...body,[field]:'arbitrary'}),false);
});
test('invitation metadata never contains tokens and every unsafe route requires CSRF',()=>{
 const valid=schema('StaffInvitation'),body={id:'00000000-0000-4000-8000-000000000001',loginName:'+8619900000001',status:'PENDING',createdAt:'2026-10-04T00:00:00Z',expiresAt:'2026-10-07T00:00:00Z',deliveryMode:'LOCAL'};
 assert.ok(valid(body));assert.equal(valid({...body,token:'secret'}),false);
 for(const verbs of Object.values(spec.paths))for(const [verb,operation] of Object.entries(verbs)) {
   assert.deepEqual(operation.security,[{platformSessionCookie:[]}]);
   if(verb==='post')assert.ok(operation.parameters.some(p=>p.name==='X-CSRF-TOKEN'&&p.required));
 }
});

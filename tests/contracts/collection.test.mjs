import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
const spec=JSON.parse(readFileSync(new URL('../../contracts/public-api/collection.openapi.json',import.meta.url)));
const ajv=new Ajv2020({strict:false,formats:{uuid:true,'date-time':true}});ajv.addSchema(spec,'collection');
const valid=name=>ajv.compile({$ref:`collection#/components/schemas/${name}`});
const id='00000000-0000-4000-8000-000000000001';
test('collection frequency is explicit and separate from connection permissions and briefing generation',()=>{
 const validate=valid('Configure'),body={requestId:id,expectedRevision:0,schedule:{enabled:true,frequency:'HOURLY',dailyTime:null,timeZone:'Asia/Shanghai'}};
 assert.ok(validate(body));for(const key of ['endpoint','password','workspaceId','briefingFrequency'])assert.equal(validate({...body,[key]:'not allowed'}),false);
 assert.equal(validate({...body,schedule:{...body.schedule,frequency:null}}),false);
 assert.equal(validate({...body,schedule:{...body.schedule,frequency:'DAILY',dailyTime:'25:00'}}),false);
 assert.ok(validate({...body,schedule:{enabled:false,frequency:null,dailyTime:null,timeZone:'UTC'}}));
});
test('manual update is a revision bound idempotent request, never an uploaded result',()=>{
 const validate=valid('Update'),body={requestId:id,expectedRevision:1};assert.ok(validate(body));assert.equal(validate({...body,dataRows:[]}),false);assert.equal(validate({...body,expectedRevision:-1}),false);
 for(const path of Object.values(spec.paths))for(const [method,op] of Object.entries(path)){assert.deepEqual(op.security,[{sessionCookie:[]}]);if(method==='post')assert.ok(op.parameters.some(p=>p.name==='X-CSRF-TOKEN'&&p.required));}
 assert.equal(Object.keys(spec.paths).some(p=>p.includes('credential')||p.includes('deploy')),false);
});
test('field explanations carry deployment evidence and distinguish inference from unknown',()=>{
 const validate=valid('DatasetField');
 const field={column:'金额',type:'decimal',meaning:'待核实金额口径',unit:'',evidence:'只有源字段，缺少业务定义',status:'UNKNOWN'};
 assert.ok(validate(field));
 assert.ok(validate({...field,status:'DEPLOYMENT_INFERRED'}));
 assert.equal(validate({...field,status:'AI_CONFIRMED'}),false);
 assert.equal(validate({...field,sql:'SELECT * FROM source'}),false);
 const {evidence,...missing}=field;assert.equal(validate(missing),false);
});

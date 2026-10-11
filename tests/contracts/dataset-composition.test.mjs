import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import Ajv from 'ajv/dist/2020.js';
const schema=JSON.parse(await readFile(new URL('../../contracts/engine-api/dataset-composition.schema.json',import.meta.url),'utf8'));
const ajv=new Ajv({strict:false,formats:{uuid:true,date:true,'date-time':true}});ajv.addSchema(schema);
test('composition contract accepts one dimension and never caller shares or comparison fields',()=>{
 const validate=ajv.compile({$ref:schema.$id+'#/$defs/request'});const request={operation:'COMPOSITION',datasetId:'00000000-0000-4000-8000-000000000001',snapshotId:'00000000-0000-4000-8000-000000000002',groupColumns:['状态'],aggregation:'COUNT'};
 assert.ok(validate(request));assert.ok(validate({...request,aggregation:'SUM',valueColumn:'金额'}));
 for(const patch of [{sharePercent:'50'},{total:'100'},{baseline:'本期'},{groupColumns:['状态','门店']},{aggregation:'SUM'}])assert.equal(validate({...request,...patch}),false);
});

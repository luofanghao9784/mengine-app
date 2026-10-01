import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
const schema=JSON.parse(await readFile(new URL('../../contracts/engine-api/table-comparison.schema.json',import.meta.url),'utf8'));
const ajv=new Ajv2020({strict:false});ajv.addFormat('uuid',/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);ajv.addSchema(schema);
const validate=ajv.compile({$ref:schema.$id+'#/$defs/request'});
const request={sourceId:'00000000-0000-0000-0000-000000000001',sheet:'经营',range:'A1:C6',groupColumn:'B',periodColumn:'A',valueColumn:'C',baseline:'前期',current:'本期'};
test('comparison takes a granted source and bounded cell coordinates, never host paths or caller identity',()=>{
  assert.ok(validate(request));
  for(const changed of [{path:'/etc/private'},{tenantId:request.sourceId},{sourceId:'latest'},{range:'A:A'},{valueColumn:'金额'},{current:''}])assert.ok(!validate({...request,...changed}));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
const schema = JSON.parse(
  await readFile(new URL('../../contracts/engine-api/task-context.schema.json', import.meta.url), 'utf8'),
);
const ajv = new Ajv2020({ strict: false });
ajv.addFormat('uuid', /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
ajv.addSchema(schema);
const request = ajv.compile({ $ref: schema.$id + '#/$defs/request' }),
  check = ajv.compile({ $ref: schema.$id + '#/$defs/check' });
test('context requests never carry tenant actor or arbitrary workspace authority', () => {
  assert.ok(request({ action: 'profiles', scope: 'PERSONAL' }));
  assert.ok(
    !request({ action: 'profiles', scope: 'PERSONAL', actorId: '00000000-0000-0000-0000-000000000001' }),
  );
  assert.ok(!request({ action: 'profiles', scope: 'ALL' }));
});
test('experience selection requires exact IDs and bounded applicability evidence', () => {
  const id = '00000000-0000-0000-0000-000000000001';
  const valid = {
    action: 'experience_use',
    referenceId: id,
    versionId: id,
    requestId: id,
    decision: 'ADAPTED',
    conditions: '检查当前输入和工具前提',
  };
  assert.ok(request(valid));
  assert.ok(!request({ ...valid, conditions: '' }));
  assert.ok(!request({ ...valid, versionId: 'latest' }));
  assert.ok(!request({ ...valid, decision: 'BUSINESS_SUCCEEDED' }));
});
test('legacy check payload stays valid while only known context versions can advertise tools', () => {
  const base = {
    allowed: true,
    executionClass: 'verification',
    publicQuery: '',
    candidateTrialsAllowed: false,
  };
  assert.ok(check(base));
  assert.ok(check({ ...base, contextVersion: '1.0' }));
  assert.ok(check({ ...base, contextVersion: '1.0', datasetContextVersion: '1.0' }));
  assert.ok(!check({ ...base, contextVersion: '1.0', datasetContextVersion: '2.0' }));
  assert.ok(!check({ ...base, contextVersion: '2.0' }));
});
test('dataset reads require exact identities and bounded rows and columns, never a connection credential', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const input = { action: 'dataset_read', referenceId: id, versionId: id, offset: 99999, columnOffset: 99, columnLimit: 1 };
  assert.ok(request(input));
  assert.ok(!request({ ...input, versionId: 'latest' }));
  assert.ok(!request({ ...input, columnLimit: 11 }));
  assert.ok(!request({ ...input, connectionId: id }));
  assert.ok(!request({ ...input, sql: 'select * from customers' }));
  assert.ok(!request({ action: 'dataset_read', referenceId: id }));
});

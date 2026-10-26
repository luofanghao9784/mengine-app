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
  assert.ok(check({ ...base, contextVersion: '1.0', contextRejectionVersion: '1.0' }));
  assert.ok(!check({ ...base, contextVersion: '1.0', contextRejectionVersion: '2.0' }));
  assert.ok(check({ ...base, contextVersion: '1.0', datasetContextVersion: '1.0' }));
  assert.ok(!check({ ...base, contextVersion: '1.0', datasetContextVersion: '2.0' }));
  assert.ok(!check({ ...base, contextVersion: '2.0' }));
});
test('dataset reads require exact identities and bounded rows and columns, never a connection credential', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const input = {
    action: 'dataset_read',
    referenceId: id,
    versionId: id,
    offset: 99999,
    columnOffset: 99,
    columnLimit: 1,
  };
  assert.ok(request(input));
  assert.ok(!request({ ...input, versionId: 'latest' }));
  assert.ok(!request({ ...input, columnLimit: 11 }));
  assert.ok(!request({ ...input, connectionId: id }));
  assert.ok(!request({ ...input, sql: 'select * from customers' }));
  assert.ok(!request({ action: 'dataset_read', referenceId: id }));
});

test('general methods require a separate bridge, fixed versions and explicit adaptations without tenant authority', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const use = {
    action: 'general_experience_use',
    referenceId: id,
    versionId: id,
    requestId: id,
    decision: 'ADAPTED',
    conditions: '已检查前提',
    adjustments: '仅调整当前任务格式',
  };
  assert.ok(request(use));
  assert.ok(!request({ ...use, adjustments: '' }));
  assert.ok(!request({ ...use, tenantId: id }));
  assert.ok(!request({ ...use, scope: 'TENANT' }));
  assert.ok(!request({ ...use, versionId: 'latest' }));
  assert.ok(request({ action: 'general_experience_search', query: '核对' }));
  assert.ok(!request({ action: 'general_experience_search' }));
  assert.ok(request({ action: 'general_experience_read', referenceId: id, versionId: id, offset: 9 }));
  assert.ok(!request({ action: 'general_experience_read', referenceId: id, versionId: id, offset: 10 }));
  const base = {
    allowed: true,
    executionClass: 'verification',
    publicQuery: '',
    candidateTrialsAllowed: false,
    contextVersion: '1.0',
  };
  assert.ok(check({ ...base, generalExperienceVersion: '1.0' }));
  assert.ok(!check({ ...base, generalExperienceVersion: '2.0' }));
});

test('general result schemas exclude private contribution fields and fabricated outcomes', () => {
  const response = ajv.compile({ $ref: schema.$id + '#/$defs/response' }),
    id = '00000000-0000-4000-8000-000000000001';
  const value = {
    contractVersion: '1.0',
    action: 'general_experience_use',
    referenceOnly: true,
    result: {
      id,
      versionId: id,
      attempt: 1,
      decision: 'DIRECT',
      conditions: '满足必要条件',
      adjustments: '',
      selectionRecorded: true,
      assessmentSource: 'MODEL_REPORTED',
      applicationOutcome: 'UNKNOWN',
      businessActionPerformed: false,
    },
  };
  assert.ok(response(value));
  for (const field of ['tenantId', 'sourceId', 'actorId', 'evidence'])
    assert.ok(!response({ ...value, result: { ...value.result, [field]: id } }));
  assert.ok(!response({ ...value, result: { ...value.result, applicationOutcome: 'SUCCEEDED' } }));
  assert.ok(!response({ ...value, result: { ...value.result, selectionRecorded: false } }));
  assert.ok(response({ ...value, result: { unavailable: true, reason: 'SELECTED_ONLY' } }));
});

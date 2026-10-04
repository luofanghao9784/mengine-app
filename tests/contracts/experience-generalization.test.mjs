import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
const schema = JSON.parse(
  readFileSync(
    new URL('../../contracts/engine-api/experience-generalization.schema.json', import.meta.url),
    'utf8',
  ),
);
const ajv = new Ajv({ strict: false, formats: { uuid: true } });
ajv.addSchema(schema);
const validate = ajv.compile({ $ref: schema.$id + '#/$defs/Result' }),
  validRequest = ajv.compile({ $ref: schema.$id + '#/$defs/Request' });
const id = '00000000-0000-4000-8000-000000000001';
const method = {
  title: '方法',
  summary: '摘要',
  steps: ['先检查固定来源'],
  applicable: ['来源可用'],
  excluded: ['无来源不能判断'],
  tags: ['核对'],
  basis: 'OBSERVED_EXECUTION',
};
const pass = (name) => Object.fromEntries(schema.$defs[name].required.map((k) => [k, 'PASS']));
const receipt = () => ({
  contractVersion: '1.0',
  engineVersion: 'synthetic',
  executionClass: 'verification',
  runId: id,
  lease: id,
  source: id,
  admitted: false,
  outcome: 'QUALIFIED',
  code: null,
  method,
  privacy: pass('Privacy'),
  quality: pass('Quality'),
  stages: ['CLEAN', 'PRIVACY', 'QUALITY'].map((stage) => ({
    stage,
    modelName: 'synthetic',
    modelCalls: 2,
    inputTokens: null,
    outputTokens: null,
  })),
});
test('generalization accepts only a fixed method, with no raw conversation or authority fields', () => {
  const request = {
    contractVersion: '1.0',
    job: { id, lease: id, tenant: id, source: id, original: method, protectedValues: [] },
  };
  assert.ok(validRequest(request));
  for (const extra of [{ rawConversation: 'private' }, { publish: true }, { evidence: ['raw quote'] }])
    assert.equal(validRequest({ ...request, job: { ...request.job, ...extra } }), false);
  assert.equal(
    validRequest({
      ...request,
      job: { ...request.job, original: { ...method, sourceUrl: 'https://private.test' } },
    }),
    false,
  );
});
test('qualification requires three ordered executed stages and every explicit privacy and quality check', () => {
  assert.ok(validate(receipt()), JSON.stringify(validate.errors));
  for (const part of ['privacy', 'quality'])
    for (const key of Object.keys(receipt()[part]))
      for (const value of ['FAIL', 'UNKNOWN']) {
        const r = receipt();
        r[part][key] = value;
        assert.equal(validate(r), false);
      }
  for (const stages of [
    [...receipt().stages].reverse(),
    receipt().stages.slice(0, 2),
    receipt().stages.map((s) => ({ ...s, modelCalls: 0 })),
  ])
    assert.equal(validate({ ...receipt(), stages }), false);
  const r = receipt();
  r.stages[0].inputTokens = 1;
  assert.equal(validate(r), false);
});
test('results cannot announce admission or carry original quotes, authority or source details in cleaned methods', () => {
  for (const extra of [{ quote: 'private' }, { original: method }, { tenant: id }, { admitted: true }])
    assert.equal(validate({ ...receipt(), ...extra }), false);
  for (const extra of [
    { source: id },
    { evidence: ['private'] },
    { basis: 'MANUAL_APPROVAL' },
    { approved: true },
  ])
    assert.equal(validate({ ...receipt(), method: { ...method, ...extra } }), false);
  for (const outcome of ['SKIPPED', 'REJECTED', 'FAILED', 'CANCELLED'])
    assert.equal(validate({ ...receipt(), outcome }), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv from 'ajv/dist/2020.js';
const spec = JSON.parse(
  await readFile(
    new URL('../../contracts/engine-api/experience-analysis.schema.json', import.meta.url),
    'utf8',
  ),
);
const ajv = new Ajv({ strict: false, formats: { uuid: true } });
ajv.addSchema(spec);
const id = '00000000-0000-4000-8000-000000000001';
const evidence = [{ inputId: id, quote: '合成证据' }];
const candidate = {
  targetVersionId: null,
  title: '合成方法',
  summary: '适用范围内使用',
  steps: ['核对依据'],
  applicable: ['资料已齐备'],
  excluded: ['证据缺失'],
  tags: ['核对'],
  evidence,
};
const review = {
  checks: Object.fromEntries(
    ['grounded', 'reusable', 'bounded', 'privacySafe', 'novel'].map((k) => [k, 'PASS']),
  ),
  basis: 'OBSERVED_EXECUTION',
  evidence,
};
const stage = {
  stage: 'EXTRACT',
  modelName: 'synthetic',
  modelCalls: 1,
  inputTokens: null,
  outputTokens: null,
};
const result = {
  contractVersion: '1.0',
  engineVersion: 'synthetic-v1',
  executionClass: 'verification',
  runId: id,
  lease: id,
  source: id,
  admitted: false,
  outcome: 'QUALIFIED',
  code: null,
  candidate,
  review,
  stages: [stage, { ...stage, stage: 'VERIFY' }],
};
test('experience qualification requires two bounded stages, explicit execution class and all checks, never admission', () => {
  const valid = ajv.compile({ $ref: spec.$id + '#/$defs/Result' });
  assert.ok(valid(result), JSON.stringify(valid.errors));
  for (const invalid of [
    { ...result, admitted: true },
    { ...result, executionClass: undefined },
    { ...result, stages: [stage] },
    { ...result, stages: [stage, stage] },
    { ...result, stages: [stage, { ...stage, stage: 'VERIFY', modelCalls: 0 }] },
    { ...result, review: { ...review, checks: { ...review.checks, privacySafe: 'UNKNOWN' } } },
    { ...result, review: { ...review, basis: 'REPORTED_ONLY' } },
    { ...result, candidate: null },
    { ...result, stages: [stage, { ...stage, stage: 'VERIFY', inputTokens: 5 }] },
  ])
    assert.equal(valid(invalid), false, JSON.stringify(invalid));
});
test('quality rejection, technical failure and normal skipping cannot expose candidate bodies or become human review', () => {
  const valid = ajv.compile({ $ref: spec.$id + '#/$defs/Result' });
  for (const [outcome, code] of [
    ['SKIPPED', 'DUPLICATE'],
    ['FAILED', 'EXPERIENCE_ANALYSIS_FAILED'],
    ['CANCELLED', 'CANCELLED'],
    ['REJECTED', 'PROTECTED_CONTENT'],
  ]) {
    const r = { ...result, outcome, code, candidate: null, review: null, stages: [stage] };
    assert.ok(valid(r));
    assert.equal(valid({ ...r, candidate }), false);
  }
  assert.equal(valid({ ...result, outcome: 'AWAITING_APPROVAL' }), false);
});
test('fixed inputs cannot request arbitrary tools or silently omit truncation coverage', () => {
  const valid = ajv.compile({ $ref: spec.$id + '#/$defs/Request' });
  const r = {
    contractVersion: '1.0',
    job: {
      id,
      lease: id,
      tenant: id,
      source: id,
      inputs: [{ id, kind: 'FEEDBACK', text: '合成资料', complete: false }],
      existing: [],
      protectedValues: [],
    },
  };
  assert.ok(valid(r));
  assert.equal(valid({ ...r, tools: ['shell'] }), false);
  assert.equal(
    valid({ ...r, job: { ...r.job, inputs: [{ id, kind: 'FEEDBACK', text: '合成资料' }] } }),
    false,
  );
  assert.equal(valid({ ...r, job: { ...r.job, inputs: Array(9).fill(r.job.inputs[0]) } }), false);
});

test('platform correction receipts are explicitly scoped, fixed-version corrections with no invented execution proof', () => {
  const valid = ajv.compile({ $ref: spec.$id + '#/$defs/Result' });
  const r = {
    ...result,
    scope: 'PLATFORM',
    candidate: { ...candidate, targetVersionId: id },
    review: { ...review, basis: 'FEEDBACK_CORRECTION' },
  };
  assert.ok(valid(r), JSON.stringify(valid.errors));
  assert.equal(valid({ ...r, scope: null }), false);
  assert.equal(valid({ ...r, scope: 'TENANT' }), false);
  assert.equal(valid({ ...r, candidate }), false);
  assert.equal(valid({ ...r, review }), false);
});

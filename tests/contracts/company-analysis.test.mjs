import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv from 'ajv/dist/2020.js';
const spec = JSON.parse(
  await readFile(new URL('../../contracts/engine-api/company-analysis.schema.json', import.meta.url), 'utf8'),
);
const publicSpec = JSON.parse(
  await readFile(new URL('../../contracts/public-api/profile.openapi.json', import.meta.url), 'utf8'),
);
const ajv = new Ajv({ strict: false, formats: { uuid: true, 'date-time': true } });
ajv.addSchema(spec);
const id = '00000000-0000-4000-8000-000000000001';
test('company engine receipt ties exact run and lease to bounded delivery and honest usage', () => {
  const valid = ajv.compile({ $ref: spec.$id + '#/$defs/Result' });
  const result = {
    contractVersion: '1.0',
    engineVersion: 'synthetic-v1',
    runId: id,
    lease: id,
    outcome: 'COMPLETE',
    code: null,
    candidates: [],
    modelName: 'synthetic',
    modelCalls: 1,
    inputTokens: null,
    outputTokens: null,
  };
  assert.ok(valid(result));
  assert.ok(valid({ ...result, inputTokens: 10, outputTokens: 2 }));
  assert.equal(valid({ ...result, modelCalls: 0 }), false);
  assert.equal(valid({ ...result, inputTokens: 10 }), false);
  assert.equal(valid({ ...result, modelCalls: 9 }), false);
  assert.equal(valid({ ...result, lease: undefined }), false);
  assert.equal(
    valid({
      ...result,
      outcome: 'FAILED',
      candidates: [
        {
          field: 'INDUSTRY',
          targetId: null,
          label: '体育',
          meaning: '',
          evidence: [{ chunkId: id, quote: '体育' }],
        },
      ],
    }),
    false,
  );
});
test('company input cannot replace fixed evidence with arbitrary tools or unspecified fields', () => {
  const valid = ajv.compile({ $ref: spec.$id + '#/$defs/Request' });
  const request = {
    contractVersion: '1.0',
    job: {
      id,
      lease: id,
      tenant: id,
      inputs: [{ chunkId: id, versionId: id, filename: '合成.txt', locator: 'p1', text: '企业资料' }],
      groups: ['NAME', 'INDUSTRY', 'BUSINESS', 'TERM'].map((field) => ({
        field,
        revision: 0,
        manuallyCleared: false,
        tags: [],
      })),
    },
  };
  assert.ok(valid(request));
  assert.equal(valid({ ...request, tools: ['web'] }), false);
  assert.equal(valid({ ...request, job: { ...request.job, inputs: [] } }), false);
  assert.equal(
    valid({ ...request, job: { ...request.job, inputs: Array(6).fill(request.job.inputs[0]) } }),
    false,
  );
});
test('public automatic analysis status is read-only and distinguishes pending from actual completion', () => {
  const path = publicSpec.paths['/api/v1/tenants/{tenant}/company-information/analysis'];
  assert.ok(path.get);
  assert.equal(path.post, undefined);
  const valid = ajv.compile(publicSpec.components.schemas.CompanyAnalysisStatus);
  assert.ok(valid({ state: 'WAITING', pending: 3, running: 0, attention: 0, lastCompletedAt: null }));
  assert.equal(valid({ state: 'IDLE', pending: 0, running: 0, attention: 0 }), false);
});

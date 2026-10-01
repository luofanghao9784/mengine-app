import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
const spec = JSON.parse(
  await readFile(new URL('../../contracts/public-api/plans.openapi.json', import.meta.url), 'utf8'),
);
const ajv = new Ajv2020({ strict: false, formats: { uuid: true, 'date-time': true } });
const compile = (name) => ajv.compile({ ...spec.components.schemas[name], components: spec.components });
const id = '00000000-0000-4000-8000-000000000001';
test('delegation contains scope purpose behavior resources and finite exit without another executor identity', () => {
  const validate = compile('Create');
  const config = {
    workspaceId: id,
    goal: '持续核查',
    purpose: '本人查阅',
    query: '进度',
    behavior: 'SOURCE_LOOKUP',
    materialEvents: true,
    dailyTime: null,
    timeZone: 'Asia/Shanghai',
    minIntervalSeconds: 60,
    maxRunsPerDay: 4,
    maxTotalRuns: 30,
    expiresAt: '2026-11-01T00:00:00Z',
    notificationsEnabled: true,
  };
  assert.ok(validate({ requestId: id, configuration: config }));
  assert.equal(validate({ requestId: id, configuration: config, runAs: id }), false);
  for (const key of ['purpose', 'workspaceId', 'behavior', 'expiresAt', 'maxTotalRuns']) {
    const missing = { ...config };
    delete missing[key];
    assert.equal(validate({ requestId: id, configuration: missing }), false);
  }
  assert.equal(validate({ requestId: id, configuration: { ...config, minIntervalSeconds: 0 } }), false);
  assert.equal(validate({ requestId: id, configuration: { ...config, maxRunsPerDay: 25 } }), false);
});
test('activation is explicit, optimistic and CSRF protected while notifications are separate actions', () => {
  const validate = compile('Action');
  assert.ok(validate({ requestId: id, expectedRevision: 1, action: 'ENABLE', delegationAccepted: true }));
  assert.equal(validate({ requestId: id, expectedRevision: 1, action: 'ENABLE' }), false);
  assert.ok(validate({ requestId: id, expectedRevision: 1, action: 'MUTE', delegationAccepted: false }));
  for (const path of Object.values(spec.paths))
    for (const [method, operation] of Object.entries(path))
      if (['post', 'put'].includes(method))
        assert.ok(operation.parameters.some((p) => p.name === 'X-CSRF-TOKEN' && p.required));
});

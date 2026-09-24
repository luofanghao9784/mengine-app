import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
const spec = JSON.parse(
  await readFile(new URL('../../contracts/public-api/operations.openapi.json', import.meta.url), 'utf8'),
);
const ajv = new Ajv2020({ strict: false, formats: { uuid: true, 'date-time': true } });
const check = ajv.compile({ ...spec.components.schemas.Overview, components: spec.components });
const value = {
  tenantId: null,
  days: 7,
  from: '2026-09-17T00:00:00Z',
  checkedAt: '2026-09-24T00:00:00Z',
  tasks: {
    total: 0,
    queued: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
    interrupted: 0,
    retryStarts: 0,
  },
  attemptUsage: [],
  storage: { materials: 0, versions: 0, originalBytes: 0 },
  models: [],
  errors: [],
};
test('operations only offers bounded authenticated aggregate reads', () => {
  assert.equal(Object.keys(spec.paths).length, 3);
  assert.ok(spec.security[0].sessionCookie);
  for (const route of Object.values(spec.paths)) {
    assert.deepEqual(Object.keys(route), ['get']);
    assert.deepEqual(route.get.parameters.find((p) => p.name === 'days').schema.enum, [7, 30]);
  }
  assert.ok(check(value));
  assert.equal(check({ ...value, days: 365 }), false);
});
test('operations schema forbids raw diagnostics, customer content and drilldown identifiers', () => {
  for (const field of [
    'prompt',
    'reply',
    'filename',
    'conversationId',
    'taskId',
    'workspaceId',
    'accountId',
    'modelName',
    'trace',
    'token',
  ])
    assert.equal(check({ ...value, [field]: 'private' }), false);
  assert.equal(
    check({
      ...value,
      errors: [{ code: 'raw-private-exception', tasks: 1, lastOccurredAt: value.checkedAt }],
    }),
    false,
  );
  assert.equal(check({ ...value, storage: { ...value.storage, objectId: 'private' } }), false);
  assert.ok(
    check({
      ...value,
      models: [
        {
          executionClass: 'live',
          succeededTasks: 1,
          reportedTasks: 0,
          modelCalls: 2,
          inputTokens: null,
          outputTokens: null,
        },
      ],
    }),
  );
});

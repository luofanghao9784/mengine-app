import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
const spec = JSON.parse(
  readFileSync(
    new URL('../../contracts/public-api/operation-retention.openapi.json', import.meta.url),
    'utf8',
  ),
);
test('cleanup summary contains aggregates and cannot carry private task bodies or titles', () => {
  const check = new Ajv2020({ strict: false, formats: { uuid: true, 'date-time': true } }).compile(
    spec.components.schemas.Status,
  );
  const value = {
    tenantId: null,
    pending: 1,
    failed: 0,
    complete: 2,
    removedEvents: 4,
    removedAudit: 3,
    nextDeadline: null,
    coverage: 'NEW_CLOSED_TASK_NOTIFICATIONS',
    protectedRecords: 'BUSINESS_RESULTS_USAGE_IDEMPOTENCY_AUTHORIZATION_DELETION',
  };
  assert.ok(check(value));
  assert.equal(check({ ...value, prompt: 'private task' }), false);
  assert.equal(check({ ...value, removedEvents: -1 }), false);
  for (const verbs of Object.values(spec.paths))
    assert.deepEqual(verbs.get.security, [{ sessionCookie: [] }]);
});

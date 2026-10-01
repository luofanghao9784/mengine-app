import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createOperationRetentionClient,
  isOperationRetentionStatus,
} from '../src/retention/operations-client.ts';
const tenant = '00000000-0000-4000-8000-000000000001';
const value = {
  tenantId: tenant,
  pending: 1,
  failed: 0,
  complete: 2,
  removedEvents: 4,
  removedAudit: 3,
  nextDeadline: '2026-10-01T00:00:00Z',
  coverage: 'NEW_CLOSED_TASK_NOTIFICATIONS',
  protectedRecords: 'BUSINESS_RESULTS_USAGE_IDEMPOTENCY_AUTHORIZATION_DELETION',
};
test('cleanup status cannot substitute unknown counts or claim all historical records were covered', () => {
  assert.ok(isOperationRetentionStatus(value));
  assert.equal(isOperationRetentionStatus({ ...value, removedEvents: null }), false);
  assert.equal(isOperationRetentionStatus({ ...value, coverage: 'ALL_HISTORICAL_RECORDS' }), false);
});
test('tenant and platform cleanup snapshots cannot be substituted across scopes', async () => {
  const api = createOperationRetentionClient(
    async () =>
      new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } }),
  );
  assert.deepEqual(await api(tenant), value);
  await assert.rejects(() => api(null));
  await assert.rejects(() => api('00000000-0000-4000-8000-000000000002'));
});

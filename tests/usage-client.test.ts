import test from 'node:test';
import assert from 'node:assert/strict';
import { isUsage, isPlatformUsage, createUsageClient } from '../src/operations/usage-client.ts';
const tenant = '00000000-0000-4000-8000-000000000001';
const usage = {
  tenantId: tenant,
  period: 'THIS_MONTH',
  timeZone: 'Asia/Shanghai',
  from: '2026-09-30T16:00:00Z',
  until: '2026-10-04T10:00:00Z',
  checkedAt: '2026-10-04T10:00:00Z',
  groups: [
    {
      purpose: 'WORK',
      executionClass: 'live',
      basis: 'REQUEST_STARTED',
      units: 3,
      reportedUnits: 1,
      unknownCallUnits: 0,
      pendingUnits: 1,
      modelCalls: 3,
      inputTokens: 20,
      outputTokens: 10,
    },
  ],
  days: [
    {
      date: '2026-10-04',
      workRequests: 3,
      maintenanceCalls: 0,
      unknownMaintenanceRuns: 0,
      inputTokens: 20,
      outputTokens: 10,
    },
  ],
  tools: [
    { executionClass: 'live', starts: 2, succeeded: 1, failed: 0, pending: 1, timed: 1, elapsedMillis: 20 },
  ],
  storage: { originals: 1, versions: 2, registeredBytes: 100 },
  coverage: {
    unmeteredWorkAttempts: 1,
    legacyToolReceipts: 2,
    evaluation: 'NOT_CONNECTED',
    evolution: 'NOT_ENABLED',
  },
  quota: { state: 'NOT_CONFIGURED', unit: null, limit: null, remaining: null },
};
const cost = {
  state: 'NOT_CONNECTED',
  currency: null,
  verifiedMinor: null,
  estimatedMinor: null,
  sharedAllocation: 'NOT_CONFIGURED',
};
test('usage requires scoped exact metadata and preserves unknown cost and quota', () => {
  assert.ok(isUsage(usage));
  assert.ok(isPlatformUsage({ usage, cost }));
  for (const field of ['cost', 'prompt', 'modelName', 'memberId', 'content'])
    assert.equal(isUsage({ ...usage, [field]: 'private' }), false);
  assert.equal(isPlatformUsage({ usage, cost: { ...cost, verifiedMinor: 0 } }), false);
  assert.equal(isUsage({ ...usage, quota: { ...usage.quota, remaining: 0 } }), false);
  assert.equal(isUsage({ ...usage, groups: [usage.groups[0], usage.groups[0]] }), false);
  assert.equal(isUsage({ ...usage, groups: [{ ...usage.groups[0], reportedUnits: 4 }] }), false);
  assert.equal(isUsage({ ...usage, tools: [{ ...usage.tools[0], timed: 2 }] }), false);
  assert.equal(isUsage({ ...usage, days: [{ ...usage.days[0], date: '2026-02-30' }] }), false);
  assert.equal(isUsage({ ...usage, timeZone: 'unknown-zone' }), false);
  assert.equal(isUsage({ ...usage, until: '2027-10-04T10:00:00Z' }), false);
});
test('usage client rejects wrong realm, tenant and period responses before display', async () => {
  let response: unknown = usage;
  const paths: string[] = [];
  const api = createUsageClient(async (url, init) => {
    paths.push(String(url));
    assert.equal(init?.method, 'GET');
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  await api.read('tenant', tenant, 'THIS_MONTH');
  assert.equal(paths[0], `/api/tenant-admin/v1/tenants/${tenant}/usage?period=THIS_MONTH`);
  await assert.rejects(api.read('platform', tenant, 'THIS_MONTH'));
  response = { usage, cost };
  await api.read('platform', tenant, 'THIS_MONTH');
  await assert.rejects(api.read('platform', null, 'THIS_MONTH'));
  await assert.rejects(api.read('platform', tenant, 'LAST_MONTH'));
  assert.throws(() => api.read('tenant', null, 'THIS_MONTH'));
  assert.throws(() => api.read('tenant', 'invalid', 'THIS_MONTH'));
});

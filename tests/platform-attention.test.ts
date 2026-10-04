import test from 'node:test';
import assert from 'node:assert/strict';
import type { TenantSummary } from '../contracts/public-api/platform-admin.ts';
import type { EngineTelemetry } from '../contracts/public-api/engine-telemetry.ts';
import { overviewAttention } from '../src/admin/platform-attention.ts';

function tenant(n: number, pending = false): TenantSummary {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    name: `合成企业${n}`,
    status: 'ACTIVE',
    createdAt: '2026-10-04T12:00:00Z',
    activeMemberCount: 0,
    owner: pending
      ? { state: 'AWAITING_INVITATION', accountId: null, name: null }
      : { state: 'ASSIGNED', accountId: '00000000-0000-4000-8000-000000000099', name: '合成负责人' },
  };
}
test('overview reports only the checked enterprise window, excluding pagination sentinel', () => {
  const result = overviewAttention(Array.from({ length: 21 }, (_, n) => tenant(n + 1, n === 20)));
  assert.equal(result.observedTenants, 20);
  assert.equal(result.moreTenants, true);
  assert.deepEqual(result.owners, []);
});
test('enterprise service and owner acceptance remain separate facts', () => {
  const paused = { ...tenant(1, true), status: 'SUSPENDED' as const };
  const result = overviewAttention([paused, tenant(2)]);
  assert.equal(result.owners.length, 1);
  assert.equal(result.owners[0].status, 'SUSPENDED');
  assert.equal(result.moreTenants, false);
});
test('missing monitoring remains unknown, retained failure is distinct from waiting and unresolved', () => {
  assert.equal(overviewAttention([]).waiting, undefined);
  assert.equal(overviewAttention([]).retainedFailures, undefined);
  const telemetry: EngineTelemetry = {
    tenantId: null,
    checkedAt: '2026-10-04T12:00:00Z',
    recentSeconds: 300,
    evolution: 'NOT_CONNECTED',
    channels: [
      {
        code: 'COLLECTION',
        running: 0,
        queued: 2,
        waiting: 0,
        failed: 3,
        unknown: 0,
        completedRecent: 0,
        lastCompletedAt: null,
      },
    ],
  };
  const result = overviewAttention([], telemetry);
  assert.equal(result.retainedFailures, 3);
  assert.equal(result.waiting, 0);
  assert.equal(result.unknown, 0);
});

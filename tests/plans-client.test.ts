import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlanClient } from '../src/plans/client.ts';
import { IdentityError } from '../src/identity/client.ts';
const tenant = '00000000-0000-4000-8000-000000000001',
  owner = '00000000-0000-4000-8000-000000000002',
  id = '00000000-0000-4000-8000-000000000003';
const configuration = {
  workspaceId: id,
  goal: '跟进依据',
  purpose: '本人检索',
  query: '进度',
  behavior: 'SOURCE_LOOKUP' as const,
  materialEvents: true,
  dailyTime: null,
  timeZone: 'Asia/Shanghai',
  minIntervalSeconds: 60,
  maxRunsPerDay: 4,
  maxTotalRuns: 10,
  expiresAt: '2026-11-01T00:00:00Z',
  notificationsEnabled: true,
};
const plan = {
  id,
  tenantId: tenant,
  ownerId: owner,
  revision: 1,
  executionEpoch: 0,
  status: 'DRAFT',
  runtimeState: 'IDLE',
  reason: null,
  configuration,
  nextDue: null,
  lastDispatchedAt: null,
  runs: 0,
  todayRuns: 0,
  checkedAt: null,
};
const response =
  (v: unknown): typeof fetch =>
  async () =>
    new Response(JSON.stringify(v));
const mismatch = (e: unknown) => e instanceof IdentityError && e.code === 'CONTRACT_MISMATCH';
test('plan reads reject foreign owner/tenant and fake runtime success', async () => {
  assert.deepEqual(await createPlanClient(response(plan)).get(tenant, owner, id), plan);
  for (const wrong of [
    { ...plan, ownerId: id },
    { ...plan, tenantId: id },
    { ...plan, id: tenant },
    { ...plan, runtimeState: 'AI_COMPLETED' },
    { ...plan, configuration: { ...configuration, behavior: 'PUBLISH' } },
  ])
    await assert.rejects(createPlanClient(response(wrong)).get(tenant, owner, id), mismatch);
  await assert.rejects(
    createPlanClient(response({ items: [{ ...plan, ownerId: id }], hasMore: false })).list(tenant, owner),
    mismatch,
  );
  const version = { planId: id, revision: 2, configuration, createdAt: '2026-10-01T00:00:00Z' };
  assert.deepEqual(await createPlanClient(response(version)).version(tenant, id, 2), version);
  await assert.rejects(
    createPlanClient(response({ ...version, revision: 1 })).version(tenant, id, 2),
    mismatch,
  );
});
test('runs bind to the selected plan and require real task/evidence identities', async () => {
  const run = {
    id,
    planId: id,
    planRevision: 1,
    executionEpoch: 1,
    triggerKind: 'DAILY',
    scheduledFor: '2026-10-01T01:00:00Z',
    missedSlots: 2,
    eventThrough: 1,
    sourceVersions: [{ materialId: id, versionId: owner, parseStatus: 'READY' }],
    conversationId: owner,
    taskId: tenant,
    status: 'QUEUED',
    errorCode: null,
    createdAt: '2026-10-01T02:00:00Z',
    finishedAt: null,
  };
  assert.equal(
    (await createPlanClient(response({ items: [run], hasMore: false })).runs(tenant, id)).items.length,
    1,
  );
  for (const wrong of [
    { ...run, planId: tenant },
    { ...run, taskId: null },
    { ...run, sourceVersions: [{ materialId: id, parseStatus: 'READY' }] },
  ])
    await assert.rejects(
      createPlanClient(response({ items: [wrong], hasMore: false })).runs(tenant, id),
      mismatch,
    );
});
test('explicit activation keeps the request key and obtains fresh CSRF without auto retry', async () => {
  const seen: { path: string; init?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (path, init) => {
    seen.push({ path: String(path), init });
    return String(path).endsWith('/csrf')
      ? new Response(JSON.stringify({ token: 'fresh', headerName: 'X-CSRF-TOKEN' }))
      : new Response(JSON.stringify({ ...plan, status: 'ACTIVE', revision: 2, executionEpoch: 1 }));
  };
  const body = {
    requestId: tenant,
    expectedRevision: 1,
    action: 'ENABLE' as const,
    delegationAccepted: true,
  };
  await createPlanClient(fetcher).action(tenant, owner, id, body);
  assert.equal(seen.length, 2);
  assert.equal(new Headers(seen[1].init?.headers).get('X-CSRF-TOKEN'), 'fresh');
  assert.deepEqual(JSON.parse(String(seen[1].init?.body)), body);
  const uncertain: typeof fetch = async (path) => {
    if (String(path).endsWith('/csrf'))
      return new Response(JSON.stringify({ token: 'fresh', headerName: 'X-CSRF-TOKEN' }));
    throw new Error('connection interrupted');
  };
  await assert.rejects(
    createPlanClient(uncertain).action(tenant, owner, id, body),
    (e: unknown) => e instanceof IdentityError && e.code === 'UNCERTAIN_RESULT',
  );
});

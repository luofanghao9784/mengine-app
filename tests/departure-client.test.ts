import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDepartureClient,
  isDepartureSummary,
  isDepartureView,
  isExitInventory,
  isExitPart,
  isExitCleanup,
} from '../src/departure/client.ts';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  now = '2026-10-01T00:00:00Z',
  due = '2026-10-31T00:00:00Z';
const summary = {
  id: id(3),
  tenantId: id(1),
  kind: 'TENANT_EXIT',
  targetAccountId: null,
  state: 'EXPORT_WINDOW',
  revision: 1,
  effectiveAt: now,
  deadline: due,
  completedAt: null,
  errorCode: null,
};
const view = {
  execution: summary,
  targetName: null,
  reason: '明确退出',
  policyKey: 'TENANT_EXIT_WINDOW',
  policyRevision: 0,
  stopComplete: false,
  isolationComplete: false,
  materialsComplete: false,
  objectsComplete: false,
  cancelledAt: null,
  workerAttempts: 0,
  backupState: 'PENDING_VERIFICATION',
  canCancel: false,
  canRetry: true,
  exportGrants: [{ accountId: id(8), workspaceId: id(2), workspaceName: '共享空间' }],
  materialProgress: null,
  coverage: ['独立共享范围'],
};
const inventory = {
  id: id(4),
  executionId: id(3),
  workspaceId: id(2),
  includeHistory: false,
  state: 'READY',
  revision: 1,
  itemCount: 1,
  pending: 0,
  included: 1,
  failed: 0,
  selectedScopeComplete: true,
  fullTenantMigration: false,
  createdAt: now,
  coverage: ['所选范围'],
};
const part = {
  id: id(5),
  setId: id(4),
  number: 1,
  state: 'READY',
  revision: 3,
  requestedCount: 1,
  bytes: 100,
  sha256: 'a'.repeat(64),
  generatedAt: now,
  expiresAt: '2026-10-08T00:00:00Z',
  errorCode: null,
  cleanupState: 'NONE',
  cleanedAt: null,
  removedBytes: 0,
  canDownload: true,
  items: [
    {
      ordinal: 1,
      kind: 'MATERIAL_VERSION',
      objectId: id(6),
      versionId: id(7),
      version: 1,
      state: 'INCLUDED',
      filename: '001-file.txt',
      sha256: 'b'.repeat(64),
      errorCode: null,
    },
  ],
};
const serve = (body: unknown) =>
  createDepartureClient((async (url) =>
    String(url).endsWith('/csrf')
      ? Response.json({ headerName: 'X-CSRF-TOKEN', token: 'synthetic' })
      : Response.json(body)) as typeof fetch);
test('effective facts distinguish preparation, fixed deadline and actual completion', () => {
  assert.ok(isDepartureSummary(summary));
  assert.ok(isDepartureView(view));
  assert.equal(isDepartureSummary({ ...summary, state: 'ASSESSED' }), false);
  assert.equal(isDepartureSummary({ ...summary, state: 'COMPLETE' }), false);
  assert.equal(isDepartureSummary({ ...summary, deadline: now }), false);
  assert.equal(isDepartureView({ ...view, backupState: 'COMPLETE' }), false);
});
test('scoped inventory cannot claim complete empty or full-tenant migration', () => {
  assert.ok(isExitInventory(inventory));
  assert.equal(isExitInventory({ ...inventory, fullTenantMigration: true }), false);
  assert.equal(isExitInventory({ ...inventory, itemCount: 0, included: 0 }), false);
  assert.equal(isExitInventory({ ...inventory, pending: 1 }), false);
});
test('download requires actual bounded nonempty archive and unexpired-state receipt', () => {
  assert.ok(isExitPart(part));
  assert.ok(isExitPart({ ...part, items: [{ ...part.items[0], kind: 'DATASET_SNAPSHOT' }] }));
  assert.equal(isExitPart({ ...part, items: [{ ...part.items[0], kind: 'DATABASE_DUMP' }] }), false);
  for (const patch of [
    { state: 'EXPIRED' },
    { cleanupState: 'PENDING' },
    { bytes: 0 },
    { bytes: 41943041 },
    { items: [] },
    { generatedAt: null },
  ])
    assert.equal(isExitPart({ ...part, ...patch }), false);
  assert.ok(
    isExitPart({ ...part, state: 'EXPIRED', canDownload: false, cleanupState: 'COMPLETE', cleanedAt: now }),
  );
});
test('cleanup completion needs timestamp and never asserts backup deletion', () => {
  const receipt = {
    partId: id(5),
    state: 'EXPIRED',
    cleanupState: 'COMPLETE',
    attempts: 1,
    completedAt: now,
    removedBytes: 100,
    backupState: 'PENDING_VERIFICATION',
  };
  assert.ok(isExitCleanup(receipt));
  assert.equal(isExitCleanup({ ...receipt, completedAt: null }), false);
  assert.equal(isExitCleanup({ ...receipt, backupState: 'CLEARED' }), false);
});
test('clients reject cross-tenant execution, substituted inventory and wrong part', async () => {
  await assert.rejects(serve({ ...view, execution: { ...summary, tenantId: id(9) } }).get(id(1), id(3)), {
    code: 'CONTRACT_MISMATCH',
  });
  await assert.rejects(
    serve({ ...inventory, workspaceId: id(9) }).createInventory(id(1), {
      requestId: id(8),
      executionId: id(3),
      workspaceId: id(2),
      includeHistory: false,
    }),
    { code: 'CONTRACT_MISMATCH' },
  );
  await assert.rejects(serve({ ...part, id: id(9) }).part(id(1), id(5)), { code: 'CONTRACT_MISMATCH' });
});
test('uncertain explicit exit is not automatically retried and retains supplied request ID', async () => {
  const sent: unknown[] = [];
  const client = createDepartureClient((async (url, init) => {
    if (String(url).endsWith('/csrf'))
      return Response.json({ headerName: 'X-CSRF-TOKEN', token: 'synthetic' });
    sent.push(JSON.parse(String(init?.body)));
    throw new TypeError('receipt lost');
  }) as typeof fetch);
  const body = {
    requestId: id(9),
    expectedTenantRevision: 0,
    reason: '合成退出',
    exportGrants: [],
    acceptScheduledCleanup: true,
  };
  await assert.rejects(client.exit(id(1), body), { code: 'UNCERTAIN_RESULT' });
  assert.equal(sent.length, 1);
  await assert.rejects(client.exit(id(1), body), { code: 'UNCERTAIN_RESULT' });
  assert.deepEqual(sent, [body, body]);
});

test('selected departure member is explicitly bound even when absent from current page', async () => {
  const data = {
    tenantRevision: 0,
    members: [],
    membersHaveMore: false,
    responsibilities: [],
    responsibilitiesHaveMore: false,
    canOffboard: true,
    canExit: false,
    selectedMember: { id: id(2), name: '合成成员', status: 'ACTIVE', revision: 9 },
    selectedOwner: false,
    currentExecutionId: null,
    isolationDays: 30,
  };
  const api = (body: unknown) => createDepartureClient(async () => new Response(JSON.stringify(body)));
  assert.deepEqual(await api(data).options(id(1), id(2)), data);
  await assert.rejects(
    api({ ...data, selectedMember: { ...data.selectedMember, id: id(4) } }).options(id(1), id(2)),
  );
  await assert.rejects(api({ ...data, selectedMember: null }).options(id(1), id(2)));
  await assert.rejects(api({ ...data, isolationDays: -1 }).options(id(1), id(2)));
  await assert.rejects(
    api({ items: [summary], hasMore: false }).list(id(1), 0, undefined, 'MEMBER_OFFBOARD'),
  );
});

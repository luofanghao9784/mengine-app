import test from 'node:test';
import assert from 'node:assert/strict';
import { createRetentionClient, isRetentionCase, isRetentionPolicy } from '../src/retention/client.ts';
import type { RetentionCase, RetentionPolicy } from '../contracts/public-api/retention.ts';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  now = '2026-10-01T00:00:00Z';
const keys = [
  'RESPONSIBILITY_HANDOVER',
  'IN_FLIGHT_ACTIONS',
  'EXPORT_AUTHORIZATION',
  'EXPORT_COMPLETENESS',
  'RETENTION_AND_BACKUPS',
];
const value: RetentionCase = {
  summary: {
    id: id(4),
    tenantId: id(1),
    kind: 'TENANT_EXIT',
    targetAccountId: null,
    label: '合成退出准备',
    state: 'ASSESSED',
    revision: 2,
    createdAt: now,
    changedAt: now,
  },
  targetName: null,
  targetStatus: null,
  acceptedRevision: 2,
  versionState: 'ASSESSED',
  selectedScopes: [{ id: id(2), name: '获权空间' }],
  restrictedScopeCount: 0,
  checkDefinitions: keys.map((key) => ({ key, label: key })),
  checklist: keys.map((key) => ({ key, status: 'UNCONFIRMED' })),
  executionState: 'PREPARATION_ONLY',
  assessment: {
    assessedAt: now,
    scopeCoverage: 'SELECTED_AUTHORIZED_SHARED_SCOPES',
    completeMigration: false,
    executionEnabled: false,
    blockers: ['EXECUTION_NOT_CONNECTED'],
    scopes: [
      {
        workspaceId: id(2),
        name: '获权空间',
        groups: [
          {
            key: 'MATERIAL_CURRENT',
            label: '资料',
            count: 3,
            exportSupport: 'SINGLE_ITEM_DOWNLOAD',
            scopeNote: '逐项下载原件，不含历史',
          },
        ],
        unfinishedTasks: 0,
        activePlans: null,
        cleanup: [],
        cleanupHasMore: false,
      },
    ],
    restrictedScopeCount: 0,
    exclusions: ['不含私人内容'],
    policyRevisions: { TRASH: 0 },
  },
};
const policy: RetentionPolicy = {
  definition: {
    key: 'TRASH',
    label: '普通回收期',
    defaultDays: 30,
    anchor: 'TRASHED_AT',
    currentEnforcement: 'MATERIAL_FIXED_30_DAYS',
    configurable: true,
    remainingAdapter: '待接入政策版本',
  },
  revision: 0,
  configuredDays: 30,
  changedBy: null,
  effectiveAt: null,
  reason: null,
  application: 'FUTURE_RECORDS_ONLY_ADAPTER_REQUIRED',
};
const serving = (body: unknown) =>
  createRetentionClient((async (url) =>
    String(url).endsWith('/csrf')
      ? Response.json({ headerName: 'X-CSRF-TOKEN', token: 'synthetic' })
      : Response.json(body)) as typeof fetch);
test('preparation cannot be mistaken for executed exit or complete migration', () => {
  assert.ok(isRetentionCase(value));
  assert.equal(isRetentionCase({ ...value, executionState: 'EXIT_COMPLETE' }), false);
  assert.equal(
    isRetentionCase({ ...value, assessment: { ...value.assessment, completeMigration: true } }),
    false,
  );
  assert.equal(
    isRetentionCase({ ...value, assessment: { ...value.assessment, executionEnabled: true } }),
    false,
  );
  assert.equal(isRetentionCase({ ...value, assessment: null }), false);
  assert.equal(isRetentionCase({ ...value, assessment: { ...value.assessment, blockers: [] } }), false);
});
test('revoked historical scopes cannot leak cached names or counts in projection', () => {
  const hidden = {
    ...value,
    selectedScopes: [],
    restrictedScopeCount: 1,
    assessment: { ...value.assessment!, scopes: [], restrictedScopeCount: 1 },
  };
  assert.ok(isRetentionCase(hidden));
  assert.equal(isRetentionCase({ ...hidden, assessment: value.assessment }), false);
  assert.equal(
    isRetentionCase({
      ...value,
      assessment: { ...value.assessment!, scopes: [{ ...value.assessment!.scopes[0], workspaceId: id(99) }] },
    }),
    false,
  );
});
test('cleanup completion needs actual timestamp and cannot claim backup deletion', () => {
  const receipt = {
    id: id(8),
    state: 'COMPLETE',
    attempts: 1,
    errorCode: null,
    createdAt: now,
    completedAt: now,
    backupState: 'NOT_COVERED_BY_ONLINE_CLEANUP',
  };
  const withReceipt = (r: unknown) => ({
    ...value,
    assessment: { ...value.assessment!, scopes: [{ ...value.assessment!.scopes[0], cleanup: [r] }] },
  });
  assert.ok(isRetentionCase(withReceipt(receipt)));
  assert.equal(isRetentionCase(withReceipt({ ...receipt, completedAt: null })), false);
  assert.equal(isRetentionCase(withReceipt({ ...receipt, backupState: 'ALL_COPIES_DELETED' })), false);
});
test('default and changed policies preserve separate registration and current enforcement', () => {
  assert.ok(isRetentionPolicy(policy));
  assert.equal(isRetentionPolicy({ ...policy, application: 'RETROACTIVE' }), false);
  assert.equal(isRetentionPolicy({ ...policy, revision: 1 }), false);
  assert.ok(
    isRetentionPolicy({
      ...policy,
      revision: 1,
      configuredDays: 20,
      changedBy: id(3),
      effectiveAt: now,
      reason: '仅未来对象',
    }),
  );
});
test('case and exact historical revision responses are bound to request tenant and object', async () => {
  assert.equal((await serving(value).get(id(1), id(4), 2)).acceptedRevision, 2);
  await assert.rejects(serving(value).get(id(9), id(4)), { code: 'CONTRACT_MISMATCH' });
  await assert.rejects(serving(value).get(id(1), id(9)), { code: 'CONTRACT_MISMATCH' });
  await assert.rejects(serving(value).get(id(1), id(4), 1), { code: 'CONTRACT_MISMATCH' });
});
test('checklist is fixed and cannot duplicate an item or invent grant-like actions', () => {
  assert.equal(
    isRetentionCase({ ...value, checklist: [value.checklist[0], ...value.checklist.slice(0, 4)] }),
    false,
  );
  assert.equal(
    isRetentionCase({
      ...value,
      checklist: [{ key: keys[0], status: 'GRANTED' }, ...value.checklist.slice(1)],
    }),
    false,
  );
});
test('mutations preserve submitted requestId, revision, CSRF and private no-store semantics', async () => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const client = createRetentionClient((async (url, init) => {
    calls.push({ url: String(url), init });
    return String(url).endsWith('/csrf')
      ? Response.json({ headerName: 'X-CSRF-TOKEN', token: 'synthetic' })
      : Response.json(value);
  }) as typeof fetch);
  const command = { requestId: id(10), expectedRevision: 1, action: 'ASSESS' as const };
  await client.command(id(1), id(4), command);
  await client.command(id(1), id(4), command);
  const posts = calls.filter((c) => c.init?.method === 'POST');
  assert.equal(posts.length, 2);
  assert.deepEqual(JSON.parse(String(posts[0].init?.body)), command);
  assert.equal(posts[0].init?.body, posts[1].init?.body);
  assert.equal(posts[0].init?.credentials, 'same-origin');
  assert.equal(posts[0].init?.cache, 'no-store');
  assert.equal(new Headers(posts[0].init?.headers).get('X-CSRF-TOKEN'), 'synthetic');
});
test('malformed or other-tenant preparation lists are rejected', async () => {
  await assert.rejects(
    serving({ items: [{ ...value.summary, tenantId: id(9) }], hasMore: false }).list(id(1)),
    { code: 'CONTRACT_MISMATCH' },
  );
  await assert.rejects(serving({ items: Array(21).fill(value.summary), hasMore: true }).list(id(1)), {
    code: 'CONTRACT_MISMATCH',
  });
});

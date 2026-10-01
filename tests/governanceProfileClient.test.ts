import test from 'node:test';
import assert from 'node:assert/strict';
import { createGovernanceClient } from '../src/governance/client.ts';
import { createProfileClient } from '../src/profile/client.ts';
import { createTenantClient } from '../src/tenant/client.ts';
import { IdentityError } from '../src/identity/client.ts';
const tenant = '00000000-0000-4000-8000-000000000001',
  account = '00000000-0000-4000-8000-000000000002',
  entry = '00000000-0000-4000-8000-000000000003';
const snapshot = {
  tenantId: tenant,
  ownerId: null,
  revision: 0,
  owner: false,
  canConfigure: false,
  canAcceptInitialResponsibility: false,
  canEnterManagement: true,
  capabilities: [{ workspaceId: entry, capability: 'PROFILE_MAINTAIN' }],
  pendingHandover: null,
};
const profile = {
  id: entry,
  versionId: account,
  tenantId: tenant,
  scope: 'PERSONAL',
  subjectId: account,
  key: '表达',
  kind: 'PREFERENCE',
  revision: 1,
  value: '简洁',
  provenance: '本人明确记录',
  status: 'ACTIVE',
  effectiveStatus: 'ACTIVE',
  expiresAt: null,
  changedBy: account,
  changedAt: '2026-10-01T00:00:00Z',
};
const reply =
  (value: unknown): typeof fetch =>
  async (path) =>
    new Response(
      JSON.stringify(
        String(path).endsWith('/csrf') ? { token: 'fresh-csrf', headerName: 'X-CSRF-TOKEN' } : value,
      ),
    );
const mismatch = (e: unknown) => e instanceof IdentityError && e.code === 'CONTRACT_MISMATCH';
test('governance response must bind to requested tenant and explicitly supported scopes', async () => {
  assert.deepEqual(await createGovernanceClient(reply(snapshot)).snapshot(tenant), snapshot);
  await assert.rejects(
    createGovernanceClient(reply({ ...snapshot, tenantId: account })).snapshot(tenant),
    mismatch,
  );
  await assert.rejects(
    createGovernanceClient(
      reply({ ...snapshot, capabilities: [{ workspaceId: entry, capability: 'READ_PRIVATE_CONTENT' }] }),
    ).snapshot(tenant),
    mismatch,
  );
  await assert.rejects(
    createGovernanceClient(
      reply({
        ...snapshot,
        pendingHandover: { id: entry, fromAccount: account, toAccount: tenant, status: 'ACCEPTED' },
      }),
    ).snapshot(tenant),
    mismatch,
  );
});
test('profile list rejects cross-tenant, wrong subject and wrong historical revision', async () => {
  const page = {
    tenantId: tenant,
    scope: 'PERSONAL',
    subjectId: account,
    canMaintain: true,
    hasMore: false,
    items: [profile],
    entries: [
      {
        id: entry,
        key: profile.key,
        kind: profile.kind,
        versionId: account,
        revision: 1,
        bodyAvailable: true,
      },
    ],
  };
  assert.deepEqual(await createProfileClient(reply(page)).list(tenant, 'PERSONAL', account), page);
  for (const p of [
    { ...profile, tenantId: account },
    { ...profile, subjectId: tenant },
    { ...profile, kind: 'ROLE' },
    { ...profile, effectiveStatus: 'CONFIRMED' },
  ])
    await assert.rejects(
      createProfileClient(reply({ ...page, items: [p] })).list(tenant, 'PERSONAL', account),
      mismatch,
    );
  await assert.rejects(
    createProfileClient(reply({ ...profile, revision: 2 })).get(tenant, entry, 1),
    mismatch,
  );
});
test('platform recovery only accepts pending technical receipt for the selected tenant', async () => {
  const receipt = {
    id: entry,
    tenantId: tenant,
    reason: 'OWNER_UNAVAILABLE',
    status: 'PENDING_VERIFICATION',
    createdAt: '2026-10-01T00:00:00Z',
  };
  const body = { requestId: entry, reason: 'OWNER_UNAVAILABLE' as const };
  assert.deepEqual(await createGovernanceClient(reply(receipt)).platformRecovery(tenant, body), receipt);
  await assert.rejects(
    createGovernanceClient(reply({ ...receipt, status: 'VERIFIED' })).platformRecovery(tenant, body),
    mismatch,
  );
  await assert.rejects(
    createGovernanceClient(reply({ ...receipt, tenantId: account })).platformRecovery(tenant, body),
    mismatch,
  );
});
test('safety stop cannot be mistaken for restoration or an unmatched recovery state', async () => {
  const receipt = {
    accountId: account,
    status: 'DISABLED',
    version: 1,
    securityAction: 'SECURITY_RISK',
    recoveryRequestId: entry,
    recoveryStatus: 'PENDING_VERIFICATION',
  };
  const body = { requestId: entry, expectedVersion: 0, securityAction: 'SECURITY_RISK' as const };
  assert.deepEqual(await createTenantClient(reply(receipt)).emergencyDisable(tenant, account, body), receipt);
  for (const r of [
    { ...receipt, status: 'ACTIVE' },
    { ...receipt, accountId: tenant },
    { ...receipt, recoveryRequestId: null },
  ])
    await assert.rejects(createTenantClient(reply(r)).emergencyDisable(tenant, account, body), mismatch);
});
test('governance writes retain request key, obtain fresh csrf and never automatically retry', async () => {
  const sent: { path: string; init?: RequestInit }[] = [];
  const client = createGovernanceClient(async (path, init) => {
    sent.push({ path: String(path), init });
    if (String(path).endsWith('/csrf')) return reply(null)(path, init);
    throw new TypeError('offline');
  });
  const body = { requestId: entry, expectedVersion: 7, accountId: account };
  await assert.rejects(
    client.offer(tenant, body),
    (e: unknown) => e instanceof IdentityError && e.code === 'UNCERTAIN_RESULT',
  );
  assert.equal(sent.length, 2);
  assert.deepEqual(JSON.parse(String(sent[1].init?.body)), body);
  assert.equal((sent[1].init?.headers as Record<string, string>)['X-CSRF-TOKEN'], 'fresh-csrf');
  assert.equal(sent[1].init?.credentials, 'same-origin');
});

test('profile metadata preserves recovery entry while unavailable body is never treated as present', async () => {
  const metadata = {
    id: entry,
    key: '表达',
    kind: 'PREFERENCE',
    versionId: account,
    revision: 1,
    bodyAvailable: false,
  };
  const page = {
    tenantId: tenant,
    scope: 'PERSONAL',
    subjectId: account,
    canMaintain: true,
    items: [],
    entries: [metadata],
    hasMore: false,
  };
  assert.deepEqual(await createProfileClient(reply(page)).list(tenant, 'PERSONAL', account), page);
  await assert.rejects(
    createProfileClient(reply({ ...page, items: [profile] })).list(tenant, 'PERSONAL', account),
    mismatch,
  );
  await assert.rejects(
    createProfileClient(reply({ ...page, entries: [{ ...metadata, bodyAvailable: true }] })).list(
      tenant,
      'PERSONAL',
      account,
    ),
    mismatch,
  );
  const info = {
    versionId: account,
    revision: 1,
    current: true,
    status: 'WITHDRAWN',
    effectiveStatus: 'WITHDRAWN',
    expiresAt: null,
    changedAt: profile.changedAt,
    bodyAvailable: false,
  };
  const history = { canMaintain: true, items: [info], hasMore: false };
  let requested = '';
  const client = createProfileClient(async (path) => {
    requested = String(path);
    return new Response(JSON.stringify(history));
  });
  assert.deepEqual(await client.history(tenant, entry, 20), history);
  assert(requested.endsWith(`/entries/${entry}/versions?offset=20&limit=20`));
  for (const items of [
    [info, info],
    [{ ...info, value: 'removed body' }],
    [{ ...info, provenance: 'private source' }],
  ])
    await assert.rejects(createProfileClient(reply({ ...history, items })).history(tenant, entry), mismatch);
});

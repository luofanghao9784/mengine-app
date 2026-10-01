import test from 'node:test';
import assert from 'node:assert/strict';
import { createObjectLifecycleClient, isItem } from '../src/objectlifecycle/client.ts';
import { IdentityError } from '../src/identity/client.ts';
import type { LifecycleItem } from '../contracts/public-api/object-lifecycle.ts';
const id = '00000000-0000-4000-8000-000000000001',
  space = '00000000-0000-4000-8000-000000000002',
  tenant = '00000000-0000-4000-8000-000000000003';
const item: LifecycleItem = {
  kind: 'TASK',
  objectId: id,
  workspaceId: space,
  state: 'PURGED',
  revision: 3,
  originalAnchor: '2026-10-01T00:00:00Z',
  formal: true,
  policyKey: null,
  policyRevision: null,
  policyDue: null,
  purgeAfter: null,
  attempts: 1,
  errorCode: null,
  completedAt: '2026-11-01T00:00:00Z',
  actions: [],
  contentState: 'ONLINE_BODY_ERASED',
  backupState: 'NOT_COVERED_BY_ONLINE_CLEANUP',
};
const response =
  (v: unknown): typeof fetch =>
  async () =>
    new Response(JSON.stringify(v));
const mismatch = (e: unknown) => e instanceof IdentityError && e.code === 'CONTRACT_MISMATCH';
test('online erasure cannot claim backup deletion and mismatched scopes are rejected', async () => {
  assert(isItem(item));
  assert(!isItem({ ...item, backupState: 'ALL_COPIES_GONE' }));
  assert(!isItem({ ...item, revision: -1 }));
  await assert.rejects(
    createObjectLifecycleClient(response({ items: [item], hasMore: false })).list(tenant, tenant, null, null),
    mismatch,
  );
});
test('a receipt must match the exact object and cannot redirect a destructive action', async () => {
  const f: typeof fetch = async (path) =>
    String(path).endsWith('/csrf')
      ? new Response(JSON.stringify({ token: 'x', headerName: 'X-CSRF-TOKEN' }))
      : new Response(
          JSON.stringify({
            acceptedRevision: 3,
            current: { ...item, objectId: space },
            receiptStatus: 'EXACT',
          }),
        );
  await assert.rejects(createObjectLifecycleClient(f).act(tenant, item, id, 'PURGE', true), mismatch);
});
test('uncertain destructive writes retain the original explicit revision and key without automatic retry', async () => {
  const seen: unknown[] = [];
  const f: typeof fetch = async (path, init) => {
    if (String(path).endsWith('/csrf'))
      return new Response(JSON.stringify({ token: 'x', headerName: 'X-CSRF-TOKEN' }));
    seen.push(JSON.parse(String(init?.body)));
    throw Error('lost receipt');
  };
  await assert.rejects(
    createObjectLifecycleClient(f).act(tenant, item, id, 'PURGE', true),
    (e) => e instanceof IdentityError && e.code === 'UNCERTAIN_RESULT',
  );
  assert.deepEqual(seen, [
    { requestId: id, expectedRevision: 3, action: 'PURGE', irreversibleConfirmed: true },
  ]);
});

test('historical profile and platform method maintenance bind exact version identity and blockers', async () => {
  for (const kind of ['PROFILE_VERSION', 'METHOD_VERSION'] as const) {
    const target = { ...item, kind, workspaceId: null, actions: [] };
    const preview = {
      object: target,
      trashDeadline: '2026-11-01T00:00:00Z',
      trialDeadline: null,
      methodDependency: false,
      blockers: [kind === 'PROFILE_VERSION' ? 'PROFILE_TASK_DEPENDENCY' : 'METHOD_CURRENT'],
      irreversible: true,
      independentCopies: 'INDEPENDENT_ENTERPRISE_PUBLICATIONS_SURVIVE',
    };
    assert.deepEqual(
      await createObjectLifecycleClient(response(preview)).get(
        kind === 'PROFILE_VERSION' ? tenant : undefined,
        kind,
        id,
      ),
      preview,
    );
    await assert.rejects(
      createObjectLifecycleClient(response({ ...preview, object: { ...target, objectId: space } })).get(
        tenant,
        kind,
        id,
      ),
      mismatch,
    );
    await assert.rejects(
      createObjectLifecycleClient(response({ ...preview, blockers: [null] })).get(tenant, kind, id),
      mismatch,
    );
  }
});

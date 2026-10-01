import test from 'node:test';
import assert from 'node:assert/strict';
import { createLifecycleClient, isLifecycleItem, isCleanup } from '../src/lifecycle/client.ts';
import { IdentityError } from '../src/identity/client.ts';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const item = {
  id: id(3),
  kind: 'MATERIAL',
  name: '合成',
  state: 'TRASHED',
  revision: 1,
  trashedAt: '2026-10-01T00:00:00Z',
  purgeAfter: '2026-10-31T00:00:00Z',
  cleanupJobId: null,
  canPurge: false,
};
const response = (v: unknown) =>
  new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } });
test('lifecycle preview rejects foreign object and invented restore guarantees', async () => {
  assert.ok(isLifecycleItem(item));
  assert.equal(isLifecycleItem({ ...item, revision: -1 }), false);
  for (const value of [
    {
      item: { ...item, id: id(4) },
      documents: 1,
      versions: 1,
      folders: 0,
      restoration: 'CURRENT_PERMISSIONS_NO_TASK_RESTART',
    },
    { item, documents: 1, versions: 1, folders: 0, restoration: 'RESTORE_OLD_ACCESS' },
  ])
    await assert.rejects(
      createLifecycleClient(async () => response(value)).preview(id(1), id(2), 'MATERIAL', id(3)),
      (e) => e instanceof IdentityError && e.code === 'CONTRACT_MISMATCH',
    );
});
test('uncertain lifecycle action never self-retries and binds exact scope revision and key', async () => {
  const keys: string[] = [];
  const client = createLifecycleClient(async (path, init) => {
    if (String(path).endsWith('/csrf')) return response({ headerName: 'X-CSRF-TOKEN', token: 'synthetic' });
    assert.ok(String(path).endsWith(`/lifecycle/MATERIAL/${id(3)}`));
    const b = JSON.parse(String(init?.body));
    keys.push(b.requestId);
    assert.equal(b.expectedRevision, 1);
    assert.equal(new Headers(init?.headers).get('X-CSRF-TOKEN'), 'synthetic');
    throw new TypeError('lost');
  });
  await assert.rejects(
    client.act(id(1), id(2), 'MATERIAL', id(3), { requestId: id(5), expectedRevision: 1, action: 'RESTORE' }),
  );
  assert.deepEqual(keys, [id(5)]);
});
test('online cleanup cannot claim backups complete or impossible blob counts', () => {
  const value = {
    id: id(4),
    state: 'FAILED',
    revision: 2,
    attempts: 1,
    errorCode: 'ONLINE_CLEANUP_FAILED',
    originals: 3,
    originalsRemoved: 1,
    completedAt: null,
    backupState: 'NOT_COVERED_BY_ONLINE_CLEANUP',
  };
  assert.ok(isCleanup(value));
  assert.equal(isCleanup({ ...value, originalsRemoved: 4 }), false);
  assert.equal(isCleanup({ ...value, backupState: 'ALL_BACKUPS_PURGED' }), false);
});

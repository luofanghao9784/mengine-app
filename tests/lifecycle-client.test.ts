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
  path: ['个人空间', '合成目录'],
  parentAvailable: true,
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

test('recycle name search and pagination are scoped on the server, not filtered from one page', async () => {
  const client = createLifecycleClient(async (path) => {
    const url = new URL(String(path), 'http://synthetic.test');
    assert.equal(url.pathname, `/api/v1/tenants/${id(1)}/workspaces/${id(2)}/lifecycle`);
    assert.equal(url.searchParams.get('view'), 'TRASH');
    assert.equal(url.searchParams.get('query'), '合成 & 100%');
    assert.equal(url.searchParams.get('offset'), '20');
    return response({ items: [item], hasMore: true });
  });
  const page = await client.list(id(1), id(2), 20, undefined, { view: 'TRASH', query: '合成 & 100%' });
  assert.deepEqual(page.items[0].path, item.path);
  assert.equal(page.hasMore, true);
  assert.equal(isLifecycleItem({ ...item, path: ['目录', 42] }), false);
  assert.equal(isLifecycleItem({ ...item, parentAvailable: 'yes' }), false);
});
test('recycle response cannot include active or already cleared content as recoverable', async () => {
  for (const state of ['ACTIVE', 'PURGING', 'PURGED'])
    await assert.rejects(
      createLifecycleClient(async () => response({ items: [{ ...item, state }], hasMore: false })).list(
        id(1),
        id(2),
        0,
        undefined,
        { view: 'TRASH', query: '' },
      ),
      (e) => e instanceof IdentityError && e.code === 'CONTRACT_MISMATCH',
    );
});

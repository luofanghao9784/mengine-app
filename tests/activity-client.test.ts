import test from 'node:test';
import assert from 'node:assert/strict';
import { createActivityClient } from '../src/activity/client.ts';
import { IdentityError } from '../src/identity/client.ts';
const tenant = '00000000-0000-4000-8000-000000000001',
  space = '00000000-0000-4000-8000-000000000002',
  id = '00000000-0000-4000-8000-000000000003';
const item = {
  id,
  workspaceId: space,
  workspaceName: '合成空间',
  folderId: null,
  materialId: id,
  version: 1,
  filename: '合成.txt',
  actorName: '维护成员',
  kind: 'MATERIAL_UPLOADED',
  occurredAt: '2026-09-24T00:00:00.123456Z',
};
const value = { tenantId: tenant, workspaceId: space, items: [item], nextCursor: null };
const response = (v: unknown) =>
  new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } });
test('activity client rejects foreign scope, duplicate events and malformed versions', async () => {
  for (const body of [
    { ...value, tenantId: id },
    { ...value, workspaceId: id },
    { ...value, items: [{ ...item, workspaceId: id }] },
    { ...value, items: [item, item] },
    { ...value, items: [{ ...item, version: 0 }] },
    { ...value, items: [{ ...item, kind: 'PRIVATE_TASK' }] },
  ]) {
    await assert.rejects(
      createActivityClient(async () => response(body)).list(tenant, space, null),
      (e) => e instanceof IdentityError && e.code === 'CONTRACT_MISMATCH',
    );
  }
});
test('activity requests preserve microsecond cursor and use private no-store session reads', async () => {
  const cursor = item.occurredAt + '~' + id;
  const client = createActivityClient(async (path, init) => {
    const url = new URL(String(path), 'https://example.test');
    assert.equal(url.searchParams.get('cursor'), cursor);
    assert.equal(url.searchParams.get('workspace'), space);
    assert.equal(init?.cache, 'no-store');
    assert.equal(init?.credentials, 'same-origin');
    assert.equal(init?.method, 'GET');
    return response(value);
  });
  assert.deepEqual(await client.list(tenant, space, cursor), value);
});

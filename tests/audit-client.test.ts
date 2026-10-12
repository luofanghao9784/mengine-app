import test from 'node:test';
import assert from 'node:assert/strict';
import { createTenantClient } from '../src/tenant/client.ts';
const id = '00000000-0000-4000-8000-000000000001';
test('audit filters and paging reach the existing tenant-scoped read endpoint', async () => {
  let captured = '';
  const api = createTenantClient(async (path) => {
    captured = String(path);
    return Response.json([]);
  });
  await api.records(id, 20, undefined, {
    q: '名字 & %',
    category: 'DATA',
    from: '2026-10-12T00:00:00Z',
    to: '2026-10-13T00:00:00Z',
  });
  const url = new URL(captured, 'https://test.invalid');
  assert.equal(url.pathname, `/api/tenant-admin/v1/tenants/${id}/records`);
  assert.equal(url.searchParams.get('q'), '名字 & %');
  assert.equal(url.searchParams.get('offset'), '20');
  assert.equal(url.searchParams.get('category'), 'DATA');
});
test('audit request rejects non-management events instead of treating them as visible records', async () => {
  const api = createTenantClient(async () =>
    Response.json([
      {
        id: 1,
        actorId: id,
        actorName: 'actor',
        action: 'MATERIAL_DOWNLOAD',
        targetId: id,
        targetName: 'private',
        relatedAccountId: null,
        relatedAccountName: null,
        createdAt: '2026-10-12T00:00:00Z',
      },
    ]),
  );
  await assert.rejects(api.records(id));
});

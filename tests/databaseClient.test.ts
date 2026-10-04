import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabaseClient } from '../src/database/client.ts';
import { IdentityError } from '../src/identity/client.ts';
const id = '00000000-0000-4000-8000-000000000001';
const dataset = {
  id,
  connectionId: id,
  workspaceId: id,
  workspaceName: '合成空间',
  name: '合成数据',
  description: '',
  columns: ['门店', '数量'],
  version: 1,
  rowCount: 0,
  collectedAt: '2026-10-04T00:00:00Z',
  coverageThrough: null,
  latestRun: null,
};
const mismatch = (e: unknown) => e instanceof IdentityError && e.code === 'CONTRACT_MISMATCH';
test('preview rejects foreign identity and schema mismatch but preserves empty and unknown coverage', async () => {
  for (const value of [
    { dataset: { ...dataset, id: '00000000-0000-4000-8000-000000000002' }, rows: [], hasMore: false },
    { dataset, rows: [['one-column']], hasMore: false },
    { dataset: { ...dataset, rowCount: -1 }, rows: [], hasMore: false },
  ])
    await assert.rejects(createDatabaseClient(async () => Response.json(value)).preview(id, id, 0), mismatch);
  const value = { dataset, rows: [], hasMore: false };
  assert.deepEqual(await createDatabaseClient(async () => Response.json(value)).preview(id, id, 0), value);
});
test('manual update sends only request and revision through customer CSRF without schedule or connector settings', async () => {
  const calls: { path: string; body: unknown }[] = [];
  const run = {
    id,
    triggerKind: 'MANUAL',
    status: 'QUEUED',
    reason: null,
    createdAt: '2026-10-04T00:00:00Z',
    startedAt: null,
    finishedAt: null,
  };
  const api = createDatabaseClient(async (path, init) => {
    calls.push({ path: String(path), body: init?.body ? JSON.parse(String(init.body)) : null });
    return Response.json(
      String(path).endsWith('/csrf') ? { token: 'customer-only', headerName: 'X-CSRF-TOKEN' } : run,
    );
  });
  await api.update(id, id, { requestId: id, expectedRevision: 2 });
  assert.equal(calls[0].path, '/api/v1/auth/csrf');
  assert.deepEqual(calls[1].body, { requestId: id, expectedRevision: 2 });
});

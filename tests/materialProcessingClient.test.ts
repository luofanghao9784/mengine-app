import test from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeClient } from '../src/material/knowledge-client.ts';
import { IdentityError } from '../src/identity/client.ts';
const id = '00000000-0000-4000-8000-000000000001',
  other = '00000000-0000-4000-8000-000000000002';
const item = {
  materialId: id,
  workspaceId: id,
  workspaceName: '合成空间',
  name: 'file.txt',
  versionId: id,
  version: 2,
  sizeBytes: 20,
  status: 'FAILED',
  generation: 1,
  updatedAt: '2026-10-04T00:00:00Z',
  finishedAt: null,
  canMaintain: false,
};
const value = {
  tenantId: id,
  workspaceId: id,
  query: '资料',
  state: 'ATTENTION',
  parserAvailable: false,
  maxUploadBytes: 20971520,
  summary: { total: 2, ready: 1, processing: 0, attention: 1, notStarted: 0 },
  items: [item],
  hasMore: false,
};
const mismatch = (error: unknown) => error instanceof IdentityError && error.code === 'CONTRACT_MISMATCH';
test('processing keeps scope totals distinct from filtered files and preserves unavailable parser', async () => {
  let path = '';
  const client = createKnowledgeClient(async (input) => {
    path = String(input);
    return Response.json(value);
  });
  assert.deepEqual(await client.processing(id, id, '资料', 'ATTENTION', 20), value);
  const url = new URL(path, 'http://localhost');
  assert.equal(url.pathname, `/api/v1/tenants/${id}/knowledge/processing`);
  assert.equal(url.searchParams.get('offset'), '20');
  assert.equal(url.searchParams.get('workspace'), id);
});
test('processing rejects wrong tenant, scope, state and inconsistent count/row data', async () => {
  for (const wrong of [
    { ...value, tenantId: other },
    { ...value, workspaceId: null },
    { ...value, state: 'ALL' },
    { ...value, summary: { ...value.summary, total: 0 } },
    { ...value, items: [{ ...item, workspaceId: other }] },
    { ...value, items: [{ ...item, version: 0 }] },
    { ...value, items: [{ ...item, status: 'INDEXED' }] },
    { ...value, parserAvailable: null },
  ])
    await assert.rejects(
      createKnowledgeClient(async () => Response.json(wrong)).processing(id, id, '资料', 'ATTENTION'),
      mismatch,
    );
});

test('unfiltered processing accepts the empty query used on first load', async () => {
  const empty = { ...value, query: '', workspaceId: null };
  assert.deepEqual(
    await createKnowledgeClient(async () => Response.json(empty)).processing(id, null, '', 'ATTENTION'),
    empty,
  );
});

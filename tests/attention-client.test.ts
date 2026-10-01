import test from 'node:test';
import assert from 'node:assert/strict';
import { createAttentionClient } from '../src/attention/client.ts';
import { previewCapacity } from '../src/attention/layout.ts';
const id = '00000000-0000-4000-8000-000000000001';
const item = {
  kind: 'TASK',
  id,
  workspaceId: id,
  workspaceName: '合成',
  title: '补充条件',
  state: 'WAITING_INPUT',
  instruction: '提供本次日期',
  actionLabel: '补充条件',
  conversationId: id,
  revision: 1,
  dueAt: null,
  changedAt: '2026-10-01T00:00:00Z',
};
const page = {
  tenantId: id,
  scope: 'MINE',
  total: 1,
  items: [item],
  hasMore: false,
  checkedAt: '2026-10-01T00:00:00Z',
};
const response = (v: unknown) =>
  new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } });
test('attention reads are scoped and cannot complete tasks', async () => {
  const client = createAttentionClient(async (url, init) => {
    assert.match(String(url), new RegExp(`/tenants/${id}/attention`));
    assert.equal(init?.method, 'GET');
    assert.equal(init?.cache, 'no-store');
    return response(page);
  });
  assert.deepEqual(await client(id, false), page);
});
test('hidden scopes, mismatched human states and incomplete pagination fail closed', async () => {
  for (const bad of [
    { ...page, scope: 'MANAGED' },
    { ...page, total: 0 },
    { ...page, hasMore: true },
    { ...page, items: [item, item] },
    { ...page, items: [{ ...item, state: 'RUNNING' }] },
    { ...page, items: [{ ...item, kind: 'SOURCE' }] },
  ])
    await assert.rejects(createAttentionClient(async () => response(bad))(id, false));
});
test('preview limits exactly two responsive rows without dropping expanded items', () => {
  for (const [width, count] of [
    [0, 2],
    [390, 2],
    [531, 2],
    [532, 4],
    [700, 4],
    [803, 4],
    [804, 6],
    [1500, 6],
  ])
    assert.equal(previewCapacity(width), count);
});

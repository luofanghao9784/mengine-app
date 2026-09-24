import test from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeClient } from '../src/material/knowledge-client.ts';
import { IdentityError } from '../src/identity/client.ts';
const tenant = '00000000-0000-4000-8000-000000000001',
  space = '00000000-0000-4000-8000-000000000002',
  id = '00000000-0000-4000-8000-000000000003';
const chunk = {
  id,
  tenantId: tenant,
  workspaceId: space,
  materialId: id,
  versionId: id,
  runId: id,
  version: 1,
  filename: 'test.md',
  locator: '第 1 行',
  method: 'TEXT',
  content: 'hello',
};
const analysis = {
  tenantId: tenant,
  workspaceId: space,
  materialId: id,
  versionId: id,
  generation: 1,
  status: 'READY',
  parserVersion: 'local-1',
  warnings: [],
  canMaintain: true,
  available: true,
  chunks: [chunk],
  hasMore: false,
};
const response = (v: unknown) =>
  new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } });
test('analysis and citations reject foreign scopes and mismatched fixed versions', async () => {
  for (const value of [
    { ...analysis, tenantId: id },
    { ...analysis, chunks: [{ ...chunk, workspaceId: id }] },
    { ...analysis, chunks: [{ ...chunk, versionId: tenant }] },
  ]) {
    await assert.rejects(
      createKnowledgeClient(async () => response(value)).analysis(tenant, space, id, id),
      (e) => e instanceof IdentityError && e.code === 'CONTRACT_MISMATCH',
    );
  }
  await assert.rejects(
    createKnowledgeClient(async () => response({ ...chunk, id: space })).citation(tenant, id),
  );
});
test('search validates query, tenant and explicit space; parse uses current CSRF without auto replay', async () => {
  for (const value of [
    { tenantId: id, workspaceId: space, query: 'hello', items: [chunk], hasMore: false },
    {
      tenantId: tenant,
      workspaceId: space,
      query: 'hello',
      items: [{ ...chunk, workspaceId: id }],
      hasMore: false,
    },
  ])
    await assert.rejects(createKnowledgeClient(async () => response(value)).search(tenant, space, 'hello'));
  let sends = 0;
  const api = createKnowledgeClient(async (path, init) => {
    if (String(path).endsWith('/csrf')) return response({ token: 'synthetic', headerName: 'X-CSRF-TOKEN' });
    sends++;
    assert.equal(new Headers(init?.headers).get('X-CSRF-TOKEN'), 'synthetic');
    throw new TypeError('lost reply');
  });
  await assert.rejects(
    api.parse(tenant, space, id, id, { requestId: id, expectedGeneration: 1 }),
    (e) => e instanceof IdentityError && e.code === 'UNCERTAIN_RESULT',
  );
  assert.equal(sends, 1);
});

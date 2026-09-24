import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicationClient } from '../src/documents/publication-client.ts';
const tenant = '00000000-0000-4000-8000-000000000001',
  doc = '00000000-0000-4000-8000-000000000002',
  workspace = '00000000-0000-4000-8000-000000000003',
  material = '00000000-0000-4000-8000-000000000004';
const publication = {
  id: material,
  tenantId: tenant,
  documentId: doc,
  documentVersion: 2,
  workspaceId: workspace,
  folderId: null,
  materialId: material,
  materialVersionId: doc,
  materialVersion: 3,
  format: 'docx',
  filename: '合成报告.docx',
  sha256: 'a'.repeat(64),
  publishedAt: '2026-09-24T03:00:00Z',
};
const payload = {
  requestId: doc,
  workspaceId: workspace,
  format: 'docx' as const,
  acknowledgeIndependentCopy: true as const,
};
const json = (v: unknown) =>
  new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } });
const client = (v: unknown) =>
  createPublicationClient(async (url) =>
    String(url).endsWith('/csrf') ? json({ token: 'synthetic', headerName: 'X-CSRF-TOKEN' }) : json(v),
  );
test('publication receipt must bind exact source version and requested target scope', async () => {
  assert.deepEqual(await client(publication).publish(tenant, doc, 2, payload), publication);
  for (const changed of [
    { tenantId: doc },
    { documentId: tenant },
    { documentVersion: 3 },
    { workspaceId: doc },
    { folderId: doc },
    { format: 'pdf' },
    { sha256: 'bad' },
  ])
    await assert.rejects(client({ ...publication, ...changed }).publish(tenant, doc, 2, payload));
  await assert.rejects(
    client(publication).publish(tenant, doc, 2, { ...payload, materialId: doc, expectedMaterialVersion: 1 }),
  );
});
test('private publication history rejects foreign document and duplicate receipts', async () => {
  for (const items of [[publication, publication], [{ ...publication, documentId: tenant }]])
    await assert.rejects(
      client({ tenantId: tenant, documentId: doc, items, hasMore: false }).list(tenant, doc),
    );
});
test('publication transport uses CSRF and preserves the explicit permission acknowledgement', async () => {
  const api = createPublicationClient(async (url, init) => {
    if (String(url).endsWith('/csrf')) return json({ token: 'synthetic', headerName: 'X-CSRF-TOKEN' });
    assert.equal(new Headers(init?.headers).get('X-CSRF-TOKEN'), 'synthetic');
    assert.deepEqual(JSON.parse(String(init?.body)), payload);
    return json(publication);
  });
  await api.publish(tenant, doc, 2, payload);
});

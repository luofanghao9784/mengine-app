import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentClient } from '../src/documents/client.ts';
import { IdentityError } from '../src/identity/client.ts';
const tenant = '00000000-0000-4000-8000-000000000001',
  id = '00000000-0000-4000-8000-000000000002',
  space = '00000000-0000-4000-8000-000000000003';
const document = {
  id,
  tenantId: tenant,
  workspaceId: space,
  sourceWorkspaceId: space,
  conversationId: id,
  taskId: id,
  artifactId: null,
  revision: 2,
  title: '文稿',
  updatedAt: '2026-09-24T01:00:00Z',
};
const detail = {
  document,
  version: { number: 2, title: '文稿', body: '正文 <script>literal</script>', createdAt: document.updatedAt },
};
const response = (v: unknown) =>
  new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } });
test('document reads reject foreign identity, wrong immutable version and unbounded content', async () => {
  assert.deepEqual(await createDocumentClient(async () => response(detail)).detail(tenant, id), detail);
  for (const value of [
    { ...detail, document: { ...document, tenantId: id } },
    { ...detail, document: { ...document, id: space } },
    { ...detail, version: { ...detail.version, number: 1 } },
    { ...detail, version: { ...detail.version, body: 'x'.repeat(32769) } },
    { ...detail, document: { ...document, sourceWorkspaceId: 'unscoped' } },
  ])
    await assert.rejects(createDocumentClient(async () => response(value)).detail(tenant, id));
  await assert.rejects(createDocumentClient(async () => response(detail)).detail(tenant, id, 1));
  assert.equal(
    (
      await createDocumentClient(async () =>
        response({ ...detail, version: { ...detail.version, number: 1 } }),
      ).detail(tenant, id, 1)
    ).version.number,
    1,
  );
});
test('document list rejects other tenants and duplicate identities', async () => {
  for (const items of [[document, document], [{ ...document, tenantId: id }]])
    await assert.rejects(
      createDocumentClient(async () => response({ tenantId: tenant, items, hasMore: false })).list(tenant),
    );
});
test('document creation must identify the exact task and optional artifact requested', async () => {
  const api = createDocumentClient(async (url) =>
    String(url).endsWith('/csrf')
      ? response({ token: 'synthetic', headerName: 'X-CSRF-TOKEN' })
      : response(detail),
  );
  await assert.rejects(api.create(tenant, { requestId: id, conversationId: space, taskId: id }));
  await assert.rejects(
    api.create(tenant, { requestId: id, conversationId: id, taskId: id, artifactId: space }),
  );
  assert.equal((await api.create(tenant, { requestId: id, conversationId: id, taskId: id })).document.id, id);
});
test('save retains request key and revision through uncertain transport without automatic replay', async () => {
  let writes = 0;
  const body = { requestId: id, expectedRevision: 2, title: '文稿', body: '新正文' };
  const api = createDocumentClient(async (url, init) => {
    if (String(url).endsWith('/csrf')) return response({ token: 'synthetic', headerName: 'X-CSRF-TOKEN' });
    writes++;
    assert.equal(new Headers(init?.headers).get('X-CSRF-TOKEN'), 'synthetic');
    assert.deepEqual(JSON.parse(String(init?.body)), body);
    throw new TypeError('lost');
  });
  await assert.rejects(
    api.save(tenant, id, body),
    (e) => e instanceof IdentityError && e.code === 'UNCERTAIN_RESULT',
  );
  assert.equal(writes, 1);
});
test('export verifies bounded bytes and digest and preserves actual permission errors', async () => {
  const bytes = new TextEncoder().encode('%PDF-fixture'),
    hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  const headers = {
    'content-type': 'application/pdf',
    'content-length': String(bytes.length),
    'content-disposition': 'attachment; filename="document-v1.pdf"',
    'x-content-sha256': hash,
  };
  const api = createDocumentClient(async (url, init) => {
    assert.ok(String(url).endsWith('/versions/1/exports/pdf'));
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.cache, 'no-store');
    return new Response(bytes, { headers });
  });
  assert.equal(await (await api.download(tenant, id, 1, 'pdf')).text(), '%PDF-fixture');
  for (const options of [
    { body: 'tampered', headers },
    { body: 'x', headers: { ...headers, 'content-length': '2097153' } },
    { body: 'x', headers: { ...headers, 'x-content-sha256': 'bad' } },
  ])
    await assert.rejects(
      createDocumentClient(async () => new Response(options.body, { headers: options.headers })).download(
        tenant,
        id,
        1,
        'pdf',
      ),
    );
  await assert.rejects(
    createDocumentClient(
      async () =>
        new Response(JSON.stringify({ contractVersion: '1.0', code: 'DOCUMENT_NOT_FOUND' }), { status: 404 }),
    ).download(tenant, id, 1, 'pdf'),
    (e) => e instanceof IdentityError && e.status === 404 && e.code === 'DOCUMENT_NOT_FOUND',
  );
});

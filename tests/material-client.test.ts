import test from 'node:test';
import assert from 'node:assert/strict';
import { createMaterialClient, isEntry, isUploadReceipt } from '../src/material/client.ts';
import { IdentityError } from '../src/identity/client.ts';
import { isGrant, isMember } from '../src/tenant/client.ts';
const tenant = '00000000-0000-4000-8000-000000000001',
  space = '00000000-0000-4000-8000-000000000002',
  id = '00000000-0000-4000-8000-000000000003';
const entry = {
  id,
  tenantId: tenant,
  workspaceId: space,
  workspaceName: '合成空间',
  folderId: null,
  kind: 'DOCUMENT',
  name: '合成.txt',
  version: 1,
  sizeBytes: 3,
  updatedAt: '2026-09-22T00:00:00Z',
  path: ['合成空间', '合成.txt'],
  canMaintain: false,
};
const receipt = {
  ...entry,
  receiptStatus: 'EXACT',
  currentVersion: 1,
  acceptedVersion: {
    id,
    number: 1,
    filename: entry.name,
    sizeBytes: 3,
    sha256: 'a'.repeat(64),
    createdBy: id,
    createdAt: entry.updatedAt,
  },
};
const page = {
  tenantId: tenant,
  workspaceId: space,
  folderId: null,
  trail: [],
  canMaintain: false,
  maxUploadBytes: 20971520,
  items: [entry],
  hasMore: false,
};
const response = (v: unknown, status = 200, headers = {}) =>
  new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json', ...headers } });
test('material reads reject foreign scope and malformed version metadata', async () => {
  for (const value of [
    { ...page, tenantId: id },
    { ...page, workspaceId: id },
    { ...page, items: [{ ...entry, tenantId: id }] },
    { ...page, items: [{ ...entry, workspaceId: id }] },
    { ...page, items: [{ ...entry, version: 0 }] },
  ]) {
    const client = createMaterialClient(async () => response(value));
    await assert.rejects(
      client.list(tenant, space, null, '', 0),
      (e) => e instanceof IdentityError && e.code === 'CONTRACT_MISMATCH',
    );
  }
  assert.ok(isEntry(entry));
  assert.equal(isEntry({ ...entry, sizeBytes: -1 }), false);
});
test('multipart keeps browser boundary and sends fresh CSRF without embedding secrets in JSON', async () => {
  const requests: { path: string; init?: RequestInit }[] = [];
  const client = createMaterialClient(async (path, init) => {
    requests.push({ path: String(path), init });
    return String(path).endsWith('/csrf')
      ? response({ token: 'synthetic-csrf', headerName: 'X-CSRF-TOKEN' })
      : response(receipt, 201);
  });
  const file = new File(['abc'], '合成.txt');
  await client.upload(tenant, space, { requestId: id, folderId: null }, file);
  assert.equal(requests.length, 2);
  const sent = requests[1].init!;
  const headers = new Headers(sent.headers);
  assert.equal(headers.get('Content-Type'), null);
  assert.equal(headers.get('X-CSRF-TOKEN'), 'synthetic-csrf');
  assert.equal(sent.credentials, 'same-origin');
  assert.equal(sent.redirect, 'error');
  assert.equal(sent.cache, 'no-store');
  const form = sent.body as FormData;
  assert.equal(await (form.get('file') as File).text(), 'abc');
  assert.equal((form.get('file') as File).name, file.name);
  assert.deepEqual(JSON.parse(await (form.get('metadata') as Blob).text()), {
    requestId: id,
    folderId: null,
  });
});
test('uncertain upload never replays automatically and explicit retry uses the supplied key', async () => {
  let sends = 0;
  const keys: string[] = [];
  const client = createMaterialClient(async (path, init) => {
    if (String(path).endsWith('/csrf')) return response({ token: 'synthetic', headerName: 'X-CSRF-TOKEN' });
    sends++;
    keys.push(JSON.parse(await ((init!.body as FormData).get('metadata') as Blob).text()).requestId);
    if (sends === 1) throw new TypeError('synthetic lost response');
    return response(receipt, 201);
  });
  const file = new File(['abc'], '合成.txt');
  await assert.rejects(
    client.upload(tenant, space, { requestId: id }, file),
    (e) => e instanceof IdentityError && e.code === 'UNCERTAIN_RESULT',
  );
  assert.equal(sends, 1);
  await client.upload(tenant, space, { requestId: id }, file);
  assert.deepEqual(keys, [id, id]);
});
test('download returns bytes only for authorized attachment responses', async () => {
  for (const [status, headers, code] of [
    [200, { 'content-type': 'text/html' }, 'CONTRACT_MISMATCH'],
    [404, { 'content-type': 'application/json' }, 'MATERIAL_NOT_FOUND'],
  ] as const) {
    const client = createMaterialClient(
      async () =>
        new Response(
          status === 404
            ? JSON.stringify({ contractVersion: '1.0', code: 'MATERIAL_NOT_FOUND' })
            : '<html>not a file</html>',
          { status, headers },
        ),
    );
    await assert.rejects(
      client.download(tenant, space, id, id),
      (e) => e instanceof IdentityError && e.code === code,
    );
  }
  const client = createMaterialClient(
    async () =>
      new Response('abc', {
        headers: {
          'content-type': 'application/octet-stream',
          'content-disposition': 'attachment; filename="file.txt"',
        },
      }),
  );
  assert.equal(await (await client.download(tenant, space, id, id)).text(), 'abc');
});
test('maintenance permission is explicit and not inferred from tenant role', () => {
  const person = {
    accountId: id,
    email: 'synthetic@example.test',
    displayName: '合成',
    status: 'ACTIVE',
    accountStatus: 'ACTIVE',
  };
  assert.equal(isGrant(person), false);
  assert.ok(isGrant({ ...person, canMaintain: false }));
  assert.ok(isGrant({ ...person, canMaintain: true }));
  assert.ok(isMember({ ...person, role: 'TENANT_ADMIN', version: 0 }));
});

test('upload receipts distinguish accepted version from current version and refuse malformed exact claims', () => {
  assert.ok(isUploadReceipt(receipt));
  assert.ok(isUploadReceipt({ ...receipt, currentVersion: 2 }));
  assert.ok(isUploadReceipt({ ...receipt, receiptStatus: 'HISTORICAL_UNKNOWN', acceptedVersion: null }));
  assert.equal(isUploadReceipt(entry), false);
  assert.equal(isUploadReceipt({ ...receipt, currentVersion: 0 }), false);
  assert.equal(isUploadReceipt({ ...receipt, acceptedVersion: null }), false);
  assert.equal(
    isUploadReceipt({ ...receipt, acceptedVersion: { ...receipt.acceptedVersion, number: 2 } }),
    false,
  );
  assert.equal(
    isUploadReceipt({ ...receipt, acceptedVersion: { ...receipt.acceptedVersion, sizeBytes: 5 } }),
    false,
  );
});

test('editable text and pipeline receipts are bound to the requested material', async () => {
  const value = { materialId: id, versionId: space, version: 2, filename: '合成.md', content: '' };
  assert.deepEqual(
    await createMaterialClient(async () => response(value)).editableText(tenant, space, id),
    value,
  );
  await assert.rejects(
    createMaterialClient(async () => response({ ...value, materialId: tenant })).editableText(
      tenant,
      space,
      id,
    ),
    (e) => e instanceof IdentityError && e.code === 'CONTRACT_MISMATCH',
  );
  const pipeline = {
    materialId: id,
    version: 2,
    receivedAt: entry.updatedAt,
    parsing: 'READY',
    governance: 'CHECKED',
    issues: 1,
    publication: 'STALE',
  };
  assert.deepEqual(
    await createMaterialClient(async () => response(pipeline)).pipeline(tenant, space, id),
    pipeline,
  );
  for (const patch of [
    { materialId: tenant },
    { parsing: 'invented' },
    { publication: 'DONE' },
    { issues: -1 },
  ])
    await assert.rejects(
      createMaterialClient(async () => response({ ...pipeline, ...patch })).pipeline(tenant, space, id),
      (e) => e instanceof IdentityError && e.code === 'CONTRACT_MISMATCH',
    );
});

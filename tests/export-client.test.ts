import test from 'node:test';
import assert from 'node:assert/strict';
import { createExportClient, isBatch, isChoice } from '../src/export/client.ts';
import type { ExportBatch } from '../contracts/public-api/export.ts';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  now = '2026-10-01T00:00:00Z';
const selection = { objectId: id(3), version: 1, format: 'docx' as const };
const batch: ExportBatch = {
  id: id(4),
  tenantId: id(1),
  workspaceId: id(2),
  scope: 'PRIVATE',
  revision: 3,
  state: 'READY',
  requestedCount: 1,
  includedCount: 1,
  failedCount: 0,
  createdAt: now,
  generatedAt: now,
  expiresAt: '2026-10-08T00:00:00Z',
  retentionDays: 7,
  bytes: 4,
  sha256: 'a'.repeat(64),
  errorCode: null,
  canDownload: true,
  cleanup: {
    state: 'NONE',
    reason: null,
    attempts: 0,
    completedAt: null,
    removedBytes: 0,
    backupState: 'BACKUPS_SEPARATE',
  },
  items: [
    {
      ordinal: 1,
      selection,
      versionId: null,
      title: '固定版本',
      state: 'INCLUDED',
      archivePath: '001-document-v1.docx',
      sizeBytes: 10,
      sha256: 'b'.repeat(64),
      errorCode: null,
      visible: true,
    },
  ],
};
const serving = (body: unknown) =>
  createExportClient((async (url) =>
    String(url).endsWith('/csrf')
      ? Response.json({ headerName: 'X-CSRF-TOKEN', token: 'synthetic' })
      : Response.json(body)) as typeof fetch);
test('package availability requires successful content, ready state and separate cleanup', () => {
  assert.ok(isBatch(batch));
  assert.equal(isBatch({ ...batch, state: 'EXPIRED' }), false);
  assert.equal(isBatch({ ...batch, includedCount: 0 }), false);
  assert.equal(isBatch({ ...batch, cleanup: { ...batch.cleanup, state: 'COMPLETE' } }), false);
  assert.ok(
    isBatch({
      ...batch,
      state: 'EXPIRED',
      canDownload: false,
      cleanup: { ...batch.cleanup, state: 'COMPLETE', completedAt: now },
    }),
  );
});
test('source revocation cannot leak cached title, path or hash', () => {
  const hidden = {
    ...batch,
    canDownload: false,
    items: [
      {
        ...batch.items[0],
        visible: false,
        title: null,
        versionId: null,
        archivePath: null,
        sizeBytes: null,
        sha256: null,
        errorCode: 'EXPORT_ITEM_UNAVAILABLE',
      },
    ],
  };
  assert.ok(isBatch(hidden));
  assert.equal(isBatch({ ...hidden, items: [{ ...hidden.items[0], title: '旧私人标题' }] }), false);
});
test('options identify exact versions and bounded source sizes', () => {
  assert.ok(isChoice({ selection, versionId: null, title: '文稿', sizeBytes: -1, createdAt: now }));
  assert.equal(
    isChoice({
      selection: { ...selection, version: 0 },
      versionId: null,
      title: '文稿',
      sizeBytes: 10,
      createdAt: now,
    }),
    false,
  );
  assert.equal(
    isChoice({ selection, versionId: id(5), title: '文稿', sizeBytes: 2097153, createdAt: now }),
    false,
  );
});
test('client rejects cross-tenant batch and changed selected version', async () => {
  await assert.rejects(serving({ ...batch, tenantId: id(7) }).get(id(1), id(4)), {
    code: 'CONTRACT_MISMATCH',
  });
  await assert.rejects(
    serving(batch).create(id(1), {
      requestId: id(8),
      workspaceId: id(2),
      scope: 'PRIVATE',
      retentionDays: 7,
      items: [{ ...selection, version: 2 }],
    }),
    { code: 'CONTRACT_MISMATCH' },
  );
  assert.equal(
    (
      await serving(batch).create(id(1), {
        requestId: id(8),
        workspaceId: id(2),
        scope: 'PRIVATE',
        retentionDays: 7,
        items: [{ format: 'docx', version: 1, objectId: id(3) }],
      })
    ).id,
    id(4),
  );
});
test('lost create receipt reuses exact request ID and body with CSRF', async () => {
  const calls: string[] = [];
  const client = createExportClient((async (url, init) => {
    if (String(url).endsWith('/csrf')) return Response.json({ headerName: 'X-CSRF-TOKEN', token: 'test' });
    assert.equal((init?.headers as Record<string, string>)['X-CSRF-TOKEN'], 'test');
    calls.push(String(init?.body));
    if (calls.length === 1) throw new TypeError('lost receipt');
    return Response.json(batch);
  }) as typeof fetch);
  const body = {
    requestId: id(8),
    workspaceId: id(2),
    scope: 'PRIVATE' as const,
    retentionDays: 7,
    items: [selection],
  };
  await assert.rejects(client.create(id(1), body), { code: 'UNCERTAIN_RESULT' });
  await client.create(id(1), body);
  assert.equal(calls.length, 2);
  assert.equal(calls[0], calls[1]);
});
test('download checks size, real ZIP signature and SHA256 before exposing blob', async () => {
  const data = new Uint8Array([0x50, 0x4b, 3, 4]),
    checksum = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))]
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('');
  const make = (hash = checksum, length = 4) =>
    createExportClient(
      (async () =>
        new Response(data, {
          headers: {
            'Content-Type': 'application/zip',
            'Content-Disposition': 'attachment; filename=test.zip',
            'Content-Length': String(length),
            'X-Content-SHA256': hash,
          },
        })) as typeof fetch,
    );
  assert.equal((await make().download(id(1), id(4))).size, 4);
  await assert.rejects(make('b'.repeat(64)).download(id(1), id(4)), { code: 'CONTRACT_MISMATCH' });
  await assert.rejects(make(checksum, 41943041).download(id(1), id(4)), { code: 'CONTRACT_MISMATCH' });
  await assert.rejects(make(checksum, 3).download(id(1), id(4)), { code: 'CONTRACT_MISMATCH' });
});
test('expired download keeps 410 and current permission denial is not a file', async () => {
  const c = createExportClient((async () =>
    Response.json(
      { contractVersion: '1.0', code: 'EXPORT_NOT_DOWNLOADABLE', message: '已过期', retryable: false },
      { status: 410 },
    )) as typeof fetch);
  await assert.rejects(
    c.download(id(1), id(4)),
    (e: any) => e.status === 410 && e.code === 'EXPORT_NOT_DOWNLOADABLE',
  );
  const denied = createExportClient((async () =>
    Response.json(
      { contractVersion: '1.0', code: 'BULK_EXPORT_REQUIRED', message: '拒绝', retryable: false },
      { status: 403 },
    )) as typeof fetch);
  await assert.rejects(
    denied.download(id(1), id(4)),
    (e: any) => e.status === 403 && e.message.includes('批量导出资格'),
  );
});
test('scope history rejects other workspaces and enterprise options require a version ID', async () => {
  const page = {
    items: [
      {
        id: batch.id,
        tenantId: batch.tenantId,
        workspaceId: id(9),
        scope: 'PRIVATE',
        revision: 1,
        state: 'QUEUED',
        requestedCount: 1,
        createdAt: now,
        expiresAt: null,
        cleanupState: 'NONE',
      },
    ],
    hasMore: false,
    retentionDays: [1, 3, 7],
    maxItems: 50,
    maxBytes: 33554432,
  };
  await assert.rejects(serving(page).list(id(1), id(2)), { code: 'CONTRACT_MISMATCH' });
  const options = {
    items: [{ selection, versionId: null, title: '私人标题', sizeBytes: 10, createdAt: now }],
    hasMore: false,
    canExport: true,
    retentionDays: [1, 3, 7],
    maxItems: 50,
    maxBytes: 33554432,
  };
  await assert.rejects(serving(options).options(id(1), id(2), 'ENTERPRISE'), { code: 'CONTRACT_MISMATCH' });
});

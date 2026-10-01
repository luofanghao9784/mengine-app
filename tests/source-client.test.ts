import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSourceClient,
  isBusinessSource,
  isSourceSubmission,
  isDate,
} from '../src/source/source-client.ts';
import { IdentityError } from '../src/identity/client.ts';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const source = {
  id: id(3),
  tenantId: id(1),
  workspaceId: id(2),
  name: '人工业务报表',
  description: '',
  responsibleId: id(4),
  cadenceHours: 168,
  expectedFrom: '2026-01-01',
  expectedThrough: '2026-01-31',
  status: 'ACTIVE',
  revision: 0,
  coverageState: 'MISSING',
  lastSubmittedAt: null,
  dueAt: '2026-10-08T00:00:00Z',
  overdue: false,
  canMaintain: true,
  updatedAt: '2026-10-01T00:00:00Z',
};
const settings = {
  name: source.name,
  description: '',
  responsibleId: id(4),
  cadenceHours: 168,
  expectedFrom: '2026-01-01',
  expectedThrough: '2026-01-31',
  status: 'ACTIVE' as const,
};
const submission = {
  id: id(5),
  sourceId: id(3),
  coverageFrom: '2026-01-01',
  coverageThrough: '2026-01-15',
  note: '',
  status: 'ACTIVE',
  revision: 0,
  submittedBy: id(4),
  submittedAt: '2026-10-01T00:00:00Z',
  unavailableVersions: 0,
  versions: [
    { materialId: id(6), versionId: id(7), number: 1, filename: '报表.txt', sha256: 'a'.repeat(64) },
  ],
};
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const clientFor = (value: unknown) =>
  createSourceClient(async (path) =>
    String(path).endsWith('/csrf')
      ? response({ token: 'synthetic', headerName: 'X-CSRF-TOKEN' })
      : response(value),
  );

test('source validation preserves unknown coverage and rejects invalid periods and invented record shapes', () => {
  assert.ok(isBusinessSource(source));
  assert.ok(
    isBusinessSource({
      ...source,
      expectedFrom: null,
      expectedThrough: null,
      cadenceHours: null,
      coverageState: 'UNKNOWN',
    }),
  );
  assert.equal(isDate('2026-02-30'), false);
  assert.equal(isDate('2026-02-28'), true);
  for (const bad of [
    { ...source, expectedThrough: null },
    { ...source, expectedThrough: '2025-01-01' },
    { ...source, cadenceHours: 0 },
    { ...source, cadenceHours: 8761 },
    { ...source, revision: -1 },
  ])
    assert.equal(isBusinessSource(bad), false);
});

test('source reads reject another tenant/space and duplicate result records', async () => {
  for (const items of [
    [{ ...source, tenantId: id(9) }],
    [{ ...source, workspaceId: id(9) }],
    [source, source],
  ]) {
    await assert.rejects(
      clientFor({ items, hasMore: false }).list(id(1), id(2)),
      (e) => e instanceof IdentityError && e.code === 'CONTRACT_MISMATCH',
    );
  }
  await assert.rejects(
    clientFor({ ...source, id: id(9) }).get(id(1), id(2), id(3)),
    (e) => e instanceof IdentityError && e.code === 'CONTRACT_MISMATCH',
  );
});

test('fixed version receipts reject duplicate IDs, reversed coverage and mismatched source', async () => {
  assert.ok(isSourceSubmission(submission));
  assert.equal(
    isSourceSubmission({ ...submission, versions: [submission.versions[0], submission.versions[0]] }),
    false,
  );
  assert.equal(isSourceSubmission({ ...submission, coverageThrough: '2025-01-01' }), false);
  assert.equal(
    isSourceSubmission({ ...submission, versions: [{ ...submission.versions[0], sha256: 'not-a-hash' }] }),
    false,
  );
  await assert.rejects(
    clientFor({ items: [{ ...submission, sourceId: id(9) }], hasMore: false }).submissions(
      id(1),
      id(2),
      id(3),
    ),
    (e) => e instanceof IdentityError && e.code === 'CONTRACT_MISMATCH',
  );
});

test('source mutations carry explicit scope, revision and stable supplied request key after a lost response', async () => {
  const writes: { path: string; body: unknown }[] = [];
  let fail = true;
  const client = createSourceClient(async (path, init) => {
    if (String(path).endsWith('/csrf')) return response({ token: 'synthetic', headerName: 'X-CSRF-TOKEN' });
    assert.equal(init?.credentials, 'same-origin');
    assert.equal(init?.cache, 'no-store');
    writes.push({ path: String(path), body: JSON.parse(String(init?.body)) });
    if (fail) {
      fail = false;
      throw new TypeError('synthetic loss');
    }
    return response({ ...source, revision: 1 });
  });
  const body = { requestId: id(8), expectedRevision: 0, settings };
  await assert.rejects(
    client.update(id(1), id(2), id(3), body),
    (e) => e instanceof IdentityError && e.code === 'UNCERTAIN_RESULT',
  );
  assert.equal(writes.length, 1);
  await client.update(id(1), id(2), id(3), body);
  assert.deepEqual(writes[0], writes[1]);
  assert.equal(writes[0].path, `/api/v1/tenants/${id(1)}/workspaces/${id(2)}/sources/${id(3)}`);
});

test('withdrawal identifies a single declaration and does not send deletion of originals', async () => {
  const writes: { path: string; body: unknown }[] = [];
  const client = createSourceClient(async (path, init) => {
    if (String(path).endsWith('/csrf')) return response({ token: 'synthetic', headerName: 'X-CSRF-TOKEN' });
    writes.push({ path: String(path), body: JSON.parse(String(init?.body)) });
    return response({ ...submission, status: 'WITHDRAWN', revision: 1 });
  });
  const value = await client.withdraw(id(1), id(2), id(3), id(5), { requestId: id(8), expectedRevision: 0 });
  assert.equal(value.status, 'WITHDRAWN');
  assert.equal(writes.length, 1);
  assert.ok(writes[0].path.endsWith(`/submissions/${id(5)}/withdraw`));
  assert.deepEqual(writes[0].body, { requestId: id(8), expectedRevision: 0 });
});

test('source-specific errors retain status and actionable conflict semantics', async () => {
  const client = createSourceClient(async (path) =>
    String(path).endsWith('/csrf')
      ? response({ token: 'synthetic', headerName: 'X-CSRF-TOKEN' })
      : response({ contractVersion: '1.0', code: 'SOURCE_STATE_CHANGED' }, 409),
  );
  await assert.rejects(
    client.update(id(1), id(2), id(3), { requestId: id(8), expectedRevision: 0, settings }),
    (error) => {
      assert.ok(error instanceof IdentityError);
      assert.equal(error.status, 409);
      assert.equal(error.code, 'SOURCE_STATE_CHANGED');
      assert.match(error.message, /核对最新状态/);
      return true;
    },
  );
});

test('configuration history validates snapshots and rejects duplicate revision receipts', async () => {
  const version = { revision: 0, settings, changedBy: id(4), effectiveAt: '2026-10-01T00:00:00Z' };
  const result = await clientFor({ items: [version], hasMore: false }).history(id(1), id(2), id(3));
  assert.equal(result.items[0].settings.cadenceHours, 168);
  for (const items of [
    [version, version],
    [{ ...version, settings: { ...settings, responsibleId: 'invalid' } }],
    [{ ...version, revision: -1 }],
  ]) {
    await assert.rejects(
      clientFor({ items, hasMore: false }).history(id(1), id(2), id(3)),
      (e) => e instanceof IdentityError && e.code === 'CONTRACT_MISMATCH',
    );
  }
});

test('removed source versions show an explicit gap without retained names', () => {
  assert.ok(isSourceSubmission({ ...submission, versions: [], unavailableVersions: 1 }));
  assert.equal(isSourceSubmission({ ...submission, versions: [], unavailableVersions: 0 }), false);
  assert.equal(isSourceSubmission({ ...submission, unavailableVersions: -1 }), false);
});

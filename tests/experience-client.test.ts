import test from 'node:test';
import assert from 'node:assert/strict';
import { createExperienceClient, isContent, isEntry, isUse } from '../src/experience/client.ts';
const ids = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000004',
];
const content = {
  kind: 'METHOD',
  title: '人工核对',
  summary: '摘要',
  body: '步骤',
  tags: ['核对'],
  applicable: '当前资料可用',
  excluded: '不能推断事实',
  dependencies: '',
  basis: '尚未评测',
  accessMode: 'INDEPENDENT_COPY',
};
const entry = {
  id: ids[2],
  tenantId: ids[0],
  workspaceId: ids[1],
  revision: 1,
  status: 'CANDIDATE',
  latestNumber: 1,
  publishedVersion: null,
  canMaintain: true,
  version: {
    id: ids[3],
    number: 1,
    schemaVersion: 1,
    content,
    evidence: [],
    origin: 'MANUAL',
    evaluation: 'NOT_EVALUATED',
    createdBy: ids[0],
    createdAt: '2026-10-01T00:00:00Z',
  },
};
test('entry distinguishes source scope, manual origin and current state', () => {
  assert.ok(isEntry(entry));
  assert.equal(isEntry({ ...entry, status: 'PUBLISHED' }), false);
  assert.equal(isEntry({ ...entry, version: { ...entry.version, evaluation: 'VERIFIED' } }), false);
  assert.equal(isContent({ ...content, tags: ['核对', '核对'] }), false);
});
test('unknown or inapplicable experience cannot be recorded as adopted', () => {
  const u = {
    id: ids[0],
    entryId: ids[2],
    versionId: ids[3],
    taskId: null,
    contextKey: 'case',
    decision: 'UNKNOWN',
    adopted: false,
    conditions: '缺资料',
    adjustments: '',
    createdAt: '2026-10-01T00:00:00Z',
  };
  assert.ok(isUse(u));
  assert.equal(isUse({ ...u, adopted: true }), false);
  assert.ok(isUse({ ...u, decision: 'ADAPTED', adopted: true }));
});
test('client rejects a body from another tenant or a different exact version', async () => {
  const client = createExperienceClient((async () =>
    Response.json({ ...entry, tenantId: ids[1] })) as typeof fetch);
  await assert.rejects(client.get(ids[0], ids[1], ids[2]), { code: 'CONTRACT_MISMATCH' });
  const other = createExperienceClient((async () => Response.json(entry)) as typeof fetch);
  await assert.rejects(other.get(ids[0], ids[1], ids[2], ids[1]), { code: 'CONTRACT_MISMATCH' });
});
test('candidate cannot be returned through available search results', async () => {
  const summary = {
    id: ids[2],
    versionId: ids[3],
    number: 1,
    revision: 1,
    status: 'CANDIDATE',
    title: content.title,
    summary: content.summary,
    tags: [],
    applicable: content.applicable,
    excluded: '',
    origin: 'MANUAL',
    evaluation: 'NOT_EVALUATED',
  };
  const client = createExperienceClient((async () =>
    Response.json({
      items: [summary],
      hasMore: false,
      canMaintain: true,
      indexStatus: 'READY',
    })) as typeof fetch);
  await assert.rejects(client.list(ids[0], ids[1]), { code: 'CONTRACT_MISMATCH' });
  assert.equal((await client.list(ids[0], ids[1], '', '', true)).items.length, 1);
});
test('stable mutation ID and CSRF are transmitted without inferring permissions', async () => {
  const calls: { url: string; body?: string }[] = [];
  const client = createExperienceClient((async (input, init) => {
    calls.push({ url: String(input), body: typeof init?.body === 'string' ? init.body : undefined });
    if (String(input).endsWith('/csrf'))
      return Response.json({ headerName: 'X-CSRF-TOKEN', token: 'synthetic' });
    assert.equal((init?.headers as Record<string, string>)['X-CSRF-TOKEN'], 'synthetic');
    return Response.json(entry);
  }) as typeof fetch);
  const body = {
    requestId: ids[3],
    content: content as Parameters<typeof client.create>[2]['content'],
    evidence: [],
  };
  await client.create(ids[0], ids[1], body);
  await client.create(ids[0], ids[1], body);
  assert.equal(JSON.parse(calls.filter((c) => c.body)[0].body!).requestId, ids[3]);
  assert.equal(calls.filter((c) => c.body)[0].body, calls.filter((c) => c.body)[1].body);
});

test('automatic entries remain readable with truthful provenance and reject mixed evaluation labels', async () => {
  const automatic = {
    ...entry,
    status: 'PUBLISHED',
    publishedVersion: ids[3],
    version: { ...entry.version, origin: 'AUTOMATIC', evaluation: 'AUTOMATIC_CHECKED' },
  };
  const client = createExperienceClient((async () => Response.json(automatic)) as typeof fetch);
  assert.equal((await client.get(ids[0], ids[1], ids[2])).version.origin, 'AUTOMATIC');
  assert.equal(isEntry({ ...automatic, version: { ...automatic.version, origin: 'MANUAL' } }), false);
  assert.equal(
    isEntry({ ...automatic, version: { ...automatic.version, evaluation: 'NOT_EVALUATED' } }),
    false,
  );
});

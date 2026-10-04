import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createExperienceManagementClient,
  isProcessingPage,
  isGeneralReferences,
  processingLabels,
} from '../src/experience/management-client.ts';
const id = '00000000-0000-4000-8000-000000000001';
const value = {
  enabled: false,
  scopes: [{ id, name: '共享空间' }],
  counts: Object.fromEntries(Object.keys(processingLabels).map((k) => [k, 0])),
  items: [
    {
      id,
      sourceKind: 'TASK',
      state: 'FAILED',
      reason: 'TECHNICAL_FAILURE',
      updatedAt: '2026-10-04T00:00:00Z',
      entryId: null,
      versionId: null,
      workspaceId: id,
    },
  ],
  hasMore: false,
};
test('processing response enforces safe status, numeric counts and body-free records', () => {
  assert.ok(isProcessingPage(value));
  for (const item of [
    { ...value.items[0], prompt: 'private' },
    { ...value.items[0], reason: 'private-provider-error' },
    { ...value.items[0], entryId: id },
  ])
    assert.equal(isProcessingPage({ ...value, items: [item] }), false);
  assert.equal(isProcessingPage({ ...value, counts: { ...value.counts, FAILED: -1 } }), false);
});
test('processing sends filters without changing them or making mutation requests', async () => {
  const calls: string[] = [];
  const client = createExperienceManagementClient((async (input, init) => {
    assert.equal(init?.method, 'GET');
    calls.push(String(input));
    return Response.json(value);
  }) as typeof fetch);
  await client.processing(id, id, 'FAILED', 20);
  assert.match(calls[0], /state=FAILED/);
  assert.match(calls[0], /offset=20/);
  assert.match(calls[0], new RegExp('workspace=' + id));
});

test('fixed general references reject substituted local versions and any private source fields', async () => {
  const other = '00000000-0000-4000-8000-000000000002';
  const ref = {
    entryId: other,
    versionId: other,
    number: 1,
    title: '清洗方法',
    current: false,
    useState: 'AVAILABLE',
  };
  const body = { entryId: id, versionId: id, canReference: true, items: [ref], hasMore: false };
  assert.ok(isGeneralReferences(body));
  for (const key of ['tenantId', 'actorId', 'sourceId', 'proposal', 'method'])
    assert.equal(isGeneralReferences({ ...body, items: [{ ...ref, [key]: 'private' }] }), false);
  const calls: string[] = [];
  let response = { ...body };
  const api = createExperienceManagementClient((async (url) => {
    calls.push(String(url));
    return Response.json(response);
  }) as typeof fetch);
  assert.deepEqual(await api.generalReferences(id, id, id, id), body);
  assert.ok(calls[0].includes('version=' + id));
  assert.ok(calls[0].includes('workspace=' + id));
  response = { ...body, versionId: other };
  await assert.rejects(api.generalReferences(id, id, id, id));
  await assert.rejects(api.generalReferences(id, id, id, id, -1));
});

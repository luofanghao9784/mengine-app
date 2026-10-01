import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecommendationClient } from '../src/recommendation/client.ts';
const tenant = '00000000-0000-4000-8000-000000000001',
  space = '00000000-0000-4000-8000-000000000002',
  id = '00000000-0000-4000-8000-000000000003';
const target = { kind: 'TASK' as const, id, versionKey: `task:${id}:3:1` };
const item = {
  content: {
    ...target,
    workspaceId: space,
    workspaceName: '合成',
    title: '合成成果',
    excerpt: '必要限制',
    truncated: false,
    createdAt: '2026-10-01T00:00:00Z',
    executionClass: 'verification',
    conversationId: id,
    taskRevision: 3,
    attempt: 1,
    preferenceRevision: 0,
    materialId: null,
    materialVersion: 0,
    filename: '',
    pinned: false,
    openedAt: null,
  },
  score: 0.58,
  method: {
    versionId: null,
    adoptionRevision: 0,
    scope: 'BUILTIN',
    workspaceId: null,
    configurationSha: 'a'.repeat(64),
  },
  presentation: { renderer: 'source-preserving-v1', style: 'DEFAULT', profileId: null, profileRevision: 0 },
  reason: '本人任务成果',
  availability: 'AVAILABLE_IN_APP',
  feedbackTarget: {
    kind: 'BRIEFING',
    taskId: id,
    taskRevision: 3,
    attempt: 1,
    presentationVersion: 'recommendation-v1',
    presentationRevision: 1,
  },
};
const page = {
  tenantId: tenant,
  settings: { revision: 0, enabled: true },
  items: [item],
  snapshot: 'b'.repeat(64),
  hasMore: false,
  eligibleTotal: 1,
  rankedCount: 1,
  poolLimited: false,
  poolLimit: 1000,
  businessOutcome: 'NOT_ASSESSED',
};
const response = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
test('recommendation reads keep exact scope and presentation identity', async () => {
  const client = createRecommendationClient(async (url, init) => {
    const u = new URL(String(url), 'http://localhost');
    assert.equal(u.searchParams.get('workspaceId'), space);
    assert.equal(init?.method, 'GET');
    return response(page);
  });
  assert.deepEqual(await client.list(tenant, space), page);
  for (const bad of [
    { ...page, tenantId: space },
    { ...page, items: [item, item] },
    { ...page, items: [{ ...item, content: { ...item.content, workspaceId: id } }] },
    { ...page, items: [{ ...item, feedbackTarget: { ...item.feedbackTarget, taskRevision: 2 } }] },
    { ...page, businessOutcome: 'SUCCEEDED' },
    { ...page, items: [{ ...item, score: NaN }] },
  ])
    await assert.rejects(createRecommendationClient(async () => response(bad)).list(tenant, space));
});
test('independent publication metadata cannot carry a private conversation or task rating', async () => {
  const publication = {
    ...item,
    content: {
      ...item.content,
      kind: 'PUBLICATION',
      versionKey: `publication:${id}`,
      conversationId: null,
      executionClass: 'PUBLISHED_COPY',
      taskRevision: 0,
      attempt: 0,
      materialId: space,
      materialVersion: 1,
      filename: '发布.docx',
    },
    feedbackTarget: {
      kind: 'PUBLICATION',
      taskRevision: 0,
      attempt: 0,
      publicationId: space,
      materialVersionId: id,
      materialVersion: 1,
      presentationVersion: 'recommendation-v1',
      presentationRevision: 8,
    },
  };
  assert.equal(
    (
      await createRecommendationClient(async () => response({ ...page, items: [publication] })).list(
        tenant,
        space,
      )
    ).items.length,
    1,
  );
  for (const invalid of [
    { ...publication, content: { ...publication.content, conversationId: id } },
    { ...publication, feedbackTarget: item.feedbackTarget },
    { ...publication, feedbackTarget: null },
    { ...publication, feedbackTarget: { ...publication.feedbackTarget, materialVersionId: space } },
  ])
    await assert.rejects(
      createRecommendationClient(async () => response({ ...page, items: [invalid] })).list(tenant, space),
    );
});
test('pagination passes current snapshot and propagates changed-snapshot conflict', async () => {
  const client = createRecommendationClient(async (url) => {
    assert.equal(new URL(String(url), 'http://localhost').searchParams.get('snapshot'), page.snapshot);
    return response(
      { contractVersion: '1.0', code: 'RECOMMENDATION_SNAPSHOT_CHANGED', retryable: false },
      409,
    );
  });
  await assert.rejects(
    client.list(tenant, null, 20, page.snapshot),
    (e: any) => e.code === 'RECOMMENDATION_SNAPSHOT_CHANGED',
  );
});
test('settings retain caller idempotency key after lost receipt and do not auto replay', async () => {
  let writes = 0;
  const key = crypto.randomUUID(),
    body = { requestId: key, expectedRevision: 0, enabled: false };
  const client = createRecommendationClient(async (url, init) => {
    if (String(url).endsWith('/csrf')) return response({ headerName: 'X-CSRF-TOKEN', token: 'synthetic' });
    writes++;
    assert.equal(JSON.parse(String(init?.body)).requestId, key);
    if (writes === 1) throw new TypeError('synthetic lost response');
    return response({ revision: 1, enabled: false });
  });
  await assert.rejects(client.configure(tenant, body));
  assert.equal(writes, 1);
  assert.deepEqual(await client.configure(tenant, body), { revision: 1, enabled: false });
  assert.equal(writes, 2);
});
test('opening receipt never changes evidence into business success or another version', async () => {
  for (const patch of [
    { businessOutcome: 'SUCCEEDED' },
    { evidence: 'READ_AND_UNDERSTOOD' },
    { target: { ...target, versionKey: 'old' } },
  ]) {
    const client = createRecommendationClient(async (url) =>
      String(url).endsWith('/csrf')
        ? response({ headerName: 'X-CSRF-TOKEN', token: 'synthetic' })
        : response({
            target,
            openedAt: '2026-10-01T00:00:00Z',
            evidence: 'USER_OPEN_ACTION',
            businessOutcome: 'NOT_ASSESSED',
            ...patch,
          }),
    );
    await assert.rejects(client.opened(tenant, target));
  }
});

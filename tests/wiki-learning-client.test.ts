import test from 'node:test';
import assert from 'node:assert/strict';
import { createWikiLearningClient, isWikiDraft } from '../src/admin/wiki-learning-client.ts';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const draft = {
  id: id(1),
  tenantId: id(2),
  materialId: id(3),
  versionId: id(4),
  conversationId: id(5),
  taskId: id(6),
  sourceName: '合成资料',
  sourceVersion: 1,
  status: 'QUEUED',
  executionClass: 'verification',
  modelName: null,
  article: null,
};
const response = (v: unknown) =>
  new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } });
test('Wiki drafts reject foreign tenant, wrong identity and stale content', async () => {
  await assert.rejects(() =>
    createWikiLearningClient(async () => response({ ...draft, tenantId: id(7) })).detail(id(2), id(1)),
  );
  await assert.rejects(() =>
    createWikiLearningClient(async () => response({ ...draft, id: id(7) })).detail(id(2), id(1)),
  );
  assert.equal(isWikiDraft({ ...draft, status: 'SOURCE_CHANGED', article: { title: '旧文' } }), false);
  assert.equal(isWikiDraft({ ...draft, status: 'SUCCEEDED', article: null }), false);
  assert.equal(isWikiDraft(draft), true);
  assert.equal(isWikiDraft({ ...draft, status: 'RESULT_UNKNOWN' }), true);
  assert.equal(isWikiDraft({ ...draft, status: 'INTERRUPTED' }), true);
});
test('learning POST carries fixed version, generation and request key with CSRF', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const client = createWikiLearningClient(async (url, init) => {
    calls.push({ url: String(url), init });
    return response(
      String(url).endsWith('/csrf')
        ? { token: 'synthetic', headerName: 'X-CSRF-TOKEN', parameterName: '_csrf' }
        : draft,
    );
  });
  const input = { requestId: id(8), versionId: id(4), generation: 2 };
  await client.start(id(2), id(3), input);
  assert.equal(calls.at(-1)?.init?.method, 'POST');
  assert.deepEqual(JSON.parse(String(calls.at(-1)?.init?.body)), input);
  assert.equal(calls.length, 2);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createWikiArticlesClient, isArticle } from '../src/admin/wiki-articles-client.ts';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const article = {
  id: id(1),
  tenantId: id(2),
  materialId: id(3),
  revision: 1,
  archived: false,
  sourceChanged: false,
  canMaintain: true,
  sourceName: '来源资料',
  sourceVersionId: id(4),
  sourceVersion: 1,
  executionClass: 'verification',
  modelName: 'fixture',
  article: {
    title: '知识',
    intro: '导语',
    content: '合成正文',
    evidence: [{ chunkId: id(5), quote: '需要核对的合成原文' }],
  },
};
const response = (v: unknown) =>
  new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } });
test('shared Wiki rejects mismatched scope and stale body projections', async () => {
  for (const v of [
    { ...article, tenantId: id(9) },
    { ...article, id: id(9) },
  ])
    await assert.rejects(() => createWikiArticlesClient(async () => response(v)).detail(id(2), id(1)));
  assert.equal(isArticle({ ...article, sourceChanged: true }), false);
  assert.equal(isArticle({ ...article, sourceChanged: true, article: null }), true);
  await assert.rejects(() =>
    createWikiArticlesClient(async () => response({ items: [article], hasMore: false })).list(id(2), true),
  );
});
test('publication sends explicit acknowledgement and fixed optimistic revision', async () => {
  const calls: { url: string; body: unknown }[] = [];
  const client = createWikiArticlesClient(async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return response(
      String(url).endsWith('/csrf')
        ? { token: 'synthetic', headerName: 'X-CSRF-TOKEN', parameterName: '_csrf' }
        : article,
    );
  });
  const body = {
    requestId: id(6),
    expectedRevision: 0,
    acknowledged: true,
    title: '知识',
    intro: '导语',
    content: '合成正文',
  };
  await client.publish(id(2), id(7), body);
  assert.deepEqual(calls.at(-1)?.body, body);
  assert.equal(calls.length, 2);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createWikiGraphsClient, isWikiGraph } from '../src/admin/wiki-graphs-client.ts';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const graph = {
  id: id(1),
  tenantId: id(2),
  taskId: id(3),
  conversationId: id(4),
  status: 'SUCCEEDED',
  executionClass: 'verification',
  modelName: 'fixture',
  documents: [
    { id: id(5), revision: 1, title: '知识一', content: '来源必须逐项核对原件' },
    { id: id(6), revision: 2, title: '知识二', content: '验收必须逐项核对原件' },
  ],
  graph: {
    selected: [id(5), id(6)],
    relations: [
      {
        from: id(5),
        to: id(6),
        kind: 'topic',
        reason: '共同关注核对',
        evidence: [
          { articleId: id(5), quote: '必须逐项核对原件' },
          { articleId: id(6), quote: '必须逐项核对原件' },
        ],
      },
    ],
  },
};
const response = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
test('graph rejects stale bodies, foreign nodes, fabricated and one-sided evidence', () => {
  assert.ok(isWikiGraph(graph));
  assert.equal(isWikiGraph({ ...graph, status: 'SOURCE_CHANGED' }), false);
  assert.ok(isWikiGraph({ ...graph, status: 'SOURCE_CHANGED', documents: [], graph: null }));
  const relation = graph.graph.relations[0];
  for (const relation2 of [
    { ...relation, to: id(9) },
    { ...relation, evidence: [relation.evidence[0], relation.evidence[0]] },
    { ...relation, evidence: [null] },
    { ...relation, evidence: [{ articleId: id(5), quote: '编造原文无法核对' }, relation.evidence[1]] },
  ])
    assert.equal(isWikiGraph({ ...graph, graph: { ...graph.graph, relations: [relation2] } }), false);
});
test('graph binds tenant and detail id, posts fixed revisions with CSRF', async () => {
  for (const v of [
    { ...graph, id: id(9) },
    { ...graph, tenantId: id(9) },
  ])
    await assert.rejects(() => createWikiGraphsClient(async () => response(v)).detail(id(2), id(1)));
  const calls: { url: string; body: unknown }[] = [];
  const api = createWikiGraphsClient(async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    return response(
      String(url).endsWith('/csrf')
        ? { token: 'synthetic', headerName: 'X-CSRF-TOKEN', parameterName: '_csrf' }
        : graph,
    );
  });
  const selections = [{ articleId: id(5), revision: 1 }];
  await api.start(id(2), selections, id(7));
  assert.deepEqual(calls.at(-1)?.body, { requestId: id(7), articles: selections });
  assert.equal(calls.length, 2);
});

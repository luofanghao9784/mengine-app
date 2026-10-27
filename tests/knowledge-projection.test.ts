import test from 'node:test';
import assert from 'node:assert/strict';
import { knowledgeProjection } from '../src/admin/prototype/knowledge-projection.ts';

test('published counts and categories come only from server-processed knowledge', () => {
 const item = { id: 'article-ready', sourceCategory: 'SHARED_UPLOAD' };
 const snapshot = { items: [item], tabs: [{ label: '全部 1', items: [item] }], stats: { rows: [['已发布知识', '1']] }, status: '1 条已发布知识' };
 assert.equal(knowledgeProjection(snapshot), snapshot);
 assert.equal(knowledgeProjection(snapshot).items.length, 1);
 assert.equal(knowledgeProjection(snapshot).stats.rows[0][1], '1');
});
test('empty categories receive a server-only fallback without inventing background knowledge', () => {
 const snapshot = { items: [], tabs: [], stats: { rows: [['已发布知识', '0']] }, status: '0 条已发布知识' };
 const result = knowledgeProjection(snapshot);
 assert.deepEqual(result.tabs, [{ label: '全部 0', items: [] }]);
 assert.deepEqual(result.items, []);
 assert.equal(result.status, snapshot.status);
 assert.deepEqual(result.stats, snapshot.stats);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdjustmentClient, isReading, isMessage, isView } from '../src/feedback-adjustment/client.ts';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const target = {
  kind: 'PUBLICATION' as const,
  taskRevision: 0 as const,
  attempt: 0 as const,
  presentationVersion: 'recommendation-v1' as const,
  presentationRevision: 5,
  publicationId: id(2),
  materialVersionId: id(3),
  materialVersion: 1,
};
const reading = {
  workspaceId: id(1),
  cardId: id(4),
  cardKind: 'PUBLICATION' as const,
  target,
  title: '独立发布副本',
  excerpt: '',
  truncated: false,
  presentation: '{}',
  sourceVersions: [id(3)],
  contentSha256: 'a'.repeat(64),
};
const message = {
  id: id(5),
  ordinal: 1,
  taskId: id(6),
  taskRevision: 0,
  status: 'WAITING_CAPABILITY',
  waitReason: 'MODEL_NOT_CONFIGURED',
  request: '先说明适用期间',
  reading,
  historyTaskIds: [],
  reply: null,
  requiredInput: null,
  supplementalInput: '',
  createdAt: '2026-10-01T00:00:00Z',
};
const view = {
  reading,
  threadId: id(7),
  conversationId: id(8),
  threadRevision: 1,
  feedbackRevision: 1,
  items: [message],
  hasMore: false,
  nextOffset: 1,
};
test('exact publication target remains separate from private source task and unknown work is not success', () => {
  assert.ok(isReading(reading));
  assert.ok(isMessage(message));
  assert.ok(isView(view));
  assert.equal(isMessage({ ...message, status: 'FAKE_SUCCESS' }), false);
  assert.equal(isView({ ...view, items: [message, message] }), false);
  assert.equal(isReading({ ...reading, target: { ...target, taskId: id(9) } }), false);
});
test('opening is GET with exact target and never emits a feedback mutation', async () => {
  const calls: string[] = [];
  const api = createAdjustmentClient((async (url, options) => {
    calls.push(String(options?.method) + ' ' + url);
    return Response.json(view);
  }) as typeof fetch);
  assert.equal((await api.open(id(9), target)).threadId, id(7));
  assert.equal(calls.length, 1);
  assert.ok(calls[0].startsWith('GET '));
  assert.match(calls[0], /materialVersionId=/);
  assert.ok(!calls[0].includes('taskId='));
});
test('substituted presentation or source fails closed', async () => {
  const api = createAdjustmentClient((async () =>
    Response.json({
      ...view,
      reading: { ...reading, target: { ...target, presentationRevision: 6 } },
    })) as typeof fetch);
  await assert.rejects(api.open(id(9), target), (e: any) => e.code === 'CONTRACT_MISMATCH');
});
test('ordinary task feedback has no card adjustment entry', async () => {
  const api = createAdjustmentClient();
  assert.throws(() =>
    api.open(id(9), {
      kind: 'TASK',
      taskId: id(2),
      taskRevision: 1,
      attempt: 1,
      presentationVersion: 'task-v1',
      presentationRevision: 0,
    }),
  );
});

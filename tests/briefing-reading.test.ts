import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readableTask } from '../src/briefing-live/reading-state.ts';
import type { ConversationDetail } from '../contracts/public-api/conversation.ts';
const expected = {
  conversationId: 'conversation-a',
  workspaceId: 'workspace-a',
  taskId: 'task-a',
  taskRevision: 3,
  attempt: 2,
};
const detail = {
  conversation: { id: expected.conversationId, workspaceId: expected.workspaceId },
  tasks: [
    {
      id: expected.taskId,
      revision: 3,
      attempt: 2,
      status: 'SUCCEEDED',
      mode: 'AGENT',
      sourcesUnavailable: false,
    },
  ],
} as ConversationDetail;
test('a reader displays only the exact task version in its authorized workspace', () => {
  assert.equal(readableTask(undefined, expected), 'loading');
  assert.equal(readableTask(detail, expected), 'ready');
  for (const change of [
    { conversationId: 'other' },
    { workspaceId: 'other' },
    { taskId: 'other' },
    { taskRevision: 4 },
    { attempt: 1 },
  ])
    assert.equal(readableTask(detail, { ...expected, ...change }), 'changed');
});
test('revoked source permission and a non-final result cannot leak a reply under a ready card', () => {
  assert.equal(
    readableTask({ ...detail, tasks: [{ ...detail.tasks[0], sourcesUnavailable: true }] }, expected),
    'restricted',
  );
  for (const status of ['RUNNING', 'PARTIAL', 'FAILED', 'WAITING_INPUT'] as const)
    assert.equal(readableTask({ ...detail, tasks: [{ ...detail.tasks[0], status }] }, expected), 'changed');
  assert.equal(readableTask({ ...detail, tasks: [] }, expected), 'changed');
  assert.equal(readableTask({ ...detail, tasks: [...detail.tasks, ...detail.tasks] }, expected), 'changed');
});

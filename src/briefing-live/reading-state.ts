import type { ConversationDetail } from '../../contracts/public-api/conversation';

/** Do not display a newer result under an older card or feedback target. */
export function readableTask(
  detail: ConversationDetail | undefined,
  expected: {
    conversationId: string;
    taskId: string;
    taskRevision: number;
    attempt: number;
    workspaceId: string;
  },
): 'loading' | 'changed' | 'restricted' | 'ready' {
  if (!detail) return 'loading';
  const task = detail.tasks[0];
  if (
    detail.conversation.id !== expected.conversationId ||
    detail.conversation.workspaceId !== expected.workspaceId ||
    detail.tasks.length !== 1 ||
    !task ||
    task.id !== expected.taskId ||
    task.revision !== expected.taskRevision ||
    task.attempt !== expected.attempt ||
    task.status !== 'SUCCEEDED' ||
    task.mode !== 'AGENT'
  )
    return 'changed';
  if (task.sourcesUnavailable) return 'restricted';
  return 'ready';
}

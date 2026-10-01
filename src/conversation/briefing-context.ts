import { uuid } from '../identity/client.ts';
import type { ReadingTask } from '../briefing-live/TaskReadingBody';

/** URL references only; content and authority are always reloaded from the API. */
export function readBriefingContext(hash: string): ReadingTask | undefined {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const conversationId = p.get('conversation'),
    taskId = p.get('briefingTask'),
    workspaceId = p.get('briefingSpace');
  const revision = p.get('briefingRevision'),
    attempt = p.get('briefingAttempt');
  if (
    !uuid(conversationId) ||
    !uuid(taskId) ||
    !uuid(workspaceId) ||
    !revision ||
    !/^\d+$/.test(revision) ||
    !attempt ||
    !/^\d+$/.test(attempt) ||
    !Number.isSafeInteger(Number(revision)) ||
    !Number.isSafeInteger(Number(attempt))
  )
    return;
  return { conversationId, taskId, workspaceId, taskRevision: Number(revision), attempt: Number(attempt) };
}
export function briefingConversationHref(tenant: string, task: ReadingTask) {
  return (
    '#' +
    new URLSearchParams({
      tenant,
      view: 'conversations',
      conversation: task.conversationId,
      from: 'briefing',
      briefingTask: task.taskId,
      briefingSpace: task.workspaceId,
      briefingRevision: String(task.taskRevision),
      briefingAttempt: String(task.attempt),
    })
  );
}
export function retainConversationContext(href: string, current: string) {
  const next = new URLSearchParams(href.replace(/^#/, '')),
    previous = new URLSearchParams(current.replace(/^#/, ''));
  if (next.get('tenant') !== previous.get('tenant')) return href;
  if (previous.get('from') === 'briefing') next.set('from', 'briefing');
  if (next.get('conversation') === previous.get('conversation')) {
    for (const key of ['briefingTask', 'briefingSpace', 'briefingRevision', 'briefingAttempt'])
      if (previous.has(key)) next.set(key, previous.get(key)!);
  }
  return '#' + next;
}

import { uuid } from '../identity/client.ts';
import type { ReadingTask } from '../briefing-live/TaskReadingBody';
import { validCardPresentation } from '../briefing-live/card-presentation.ts';

/** URL references only; content and authority are always reloaded from the API. */
export function readBriefingContext(hash: string): ReadingTask | undefined {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const conversationId = p.get('briefingConversation') || p.get('conversation'),
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
  const presentation = validCardPresentation(p.get('briefingSize'), Number(p.get('briefingUnit')));
  return {
    conversationId,
    taskId,
    workspaceId,
    taskRevision: Number(revision),
    attempt: Number(attempt),
    ...(presentation ? { presentation } : {}),
  };
}
export function briefingConversationHref(tenant: string, task: ReadingTask, discussionId?: string) {
  return (
    '#' +
    new URLSearchParams({
      tenant,
      view: 'conversations',
      ...(discussionId ? { conversation: discussionId } : {}),
      briefingConversation: task.conversationId,
      from: 'briefing',
      briefingTask: task.taskId,
      briefingSpace: task.workspaceId,
      briefingRevision: String(task.taskRevision),
      briefingAttempt: String(task.attempt),
      ...(task.presentation
        ? { briefingSize: task.presentation.size, briefingUnit: String(task.presentation.unit) }
        : {}),
    })
  );
}
export function retainConversationContext(href: string, current: string) {
  const next = new URLSearchParams(href.replace(/^#/, '')),
    previous = new URLSearchParams(current.replace(/^#/, ''));
  if (next.get('tenant') !== previous.get('tenant')) return href;
  if (previous.get('from') === 'briefing') next.set('from', 'briefing');
  if (next.get('conversation') && next.get('conversation') === previous.get('conversation')) {
    for (const key of [
      'briefingConversation',
      'briefingTask',
      'briefingSpace',
      'briefingRevision',
      'briefingAttempt',
      'briefingSize',
      'briefingUnit',
    ])
      if (previous.has(key)) next.set(key, previous.get(key)!);
  }
  return '#' + next;
}

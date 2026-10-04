import { useEffect, useRef } from 'react';
import type { Conversation } from '../../contracts/public-api/conversation';
import { conversationClient } from './client';

/** A visible accepted reply is read; opening a hidden tab or reading old history is not. */
export function useConversationReadReceipt(
  tenant: string,
  conversation: Conversation | undefined,
  element: HTMLDivElement | null,
  changed: () => void,
) {
  const acknowledged = useRef(new Map<string, number>());
  useEffect(() => {
    const revision = conversation?.replyRevision || 0,
      task = conversation?.latestReplyTaskId;
    if (!element || !conversation || !task || !revision) return;
    const key = tenant + ':' + conversation.id;
    if ((acknowledged.current.get(key) || 0) >= revision) return;
    const target = element.querySelector<HTMLElement>(`[data-task-id="${task}"] .reply-actions`);
    if (!target) return;
    const request = new AbortController();
    let busy = false;
    const read = async () => {
      if (
        (acknowledged.current.get(key) || 0) >= revision ||
        busy ||
        request.signal.aborted ||
        document.visibilityState !== 'visible' ||
        document.querySelector('dialog[open]')
      )
        return;
      const a = target.getBoundingClientRect(),
        b = element.getBoundingClientRect();
      if (
        !a.height ||
        a.bottom <= Math.max(0, b.top) ||
        a.top >= Math.min(innerHeight, b.bottom) ||
        a.right <= Math.max(0, b.left) ||
        a.left >= Math.min(innerWidth, b.right)
      )
        return;
      busy = true;
      try {
        await conversationClient.read(tenant, conversation.id, revision, request.signal);
        if (!request.signal.aborted) {
          acknowledged.current.set(key, revision);
          changed();
          window.dispatchEvent(new Event('conversation-list-changed'));
        }
      } catch {
        /* A failed acknowledgment leaves the icon unread and is retried while visible. */
      } finally {
        busy = false;
      }
    };
    const observer = new IntersectionObserver(() => void read(), { root: element });
    observer.observe(target);
    const timer = setInterval(() => void read(), 1500);
    const visible = () => void read();
    document.addEventListener('visibilitychange', visible);
    return () => {
      request.abort();
      observer.disconnect();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [
    tenant,
    conversation?.id,
    conversation?.replyRevision,
    conversation?.latestReplyTaskId,
    element,
    changed,
  ]);
}

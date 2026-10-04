import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConversationPage } from '../../contracts/public-api/conversation';
import { useSession } from '../identity/session';
import { IdentityError } from '../identity/client';
import { Button } from '../shared/ui';
import { conversationClient } from './client';

type State = {
  scope: string;
  value?: ConversationPage;
  error?: unknown;
  moreError?: unknown;
  loading: boolean;
};
const merge = (previous: ConversationPage, next: ConversationPage): ConversationPage => ({
  ...next,
  items: [...new Map([...previous.items, ...next.items].map((item) => [item.id, item])).values()],
});

export function useConversationList(tenant: string, revision: number, trash = false) {
  const { session, expire } = useSession();
  const scope = tenant + ':' + session.identity?.account.id + ':' + trash;
  const [state, setState] = useState<State>({ scope, loading: true });
  const latest = useRef(state);
  const controller = useRef<AbortController | null>(null);
  const offset = useRef(0);
  const busy = useRef(false);
  const publish = useCallback((next: State) => {
    latest.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    const retained = latest.current.scope === scope ? latest.current.value : undefined;
    const count = retained ? Math.max(1, offset.current / 20) : 1;
    busy.current = true;
    publish({ scope, value: retained, loading: true });
    void (async () => {
      try {
        let result: ConversationPage | undefined;
        let nextOffset = 0;
        for (let page = 0; page < count; page++) {
          const next = await conversationClient.list(tenant, nextOffset, request.signal, trash);
          if (request.signal.aborted) return;
          result = result ? merge(result, next) : next;
          nextOffset += 20;
          if (!next.hasMore) break;
        }
        offset.current = nextOffset;
        publish({ scope, value: result, loading: false });
      } catch (error) {
        if (request.signal.aborted) return;
        publish({ scope, error, loading: false });
        if (error instanceof IdentityError && error.status === 401) expire();
      } finally {
        if (!request.signal.aborted) busy.current = false;
      }
    })();
    return () => request.abort();
  }, [tenant, scope, revision, session.identity, expire, publish, trash]);

  useEffect(() => {
    const request = new AbortController();
    const refresh = async () => {
      if (
        document.visibilityState !== 'visible' ||
        busy.current ||
        latest.current.scope !== scope ||
        !latest.current.value
      )
        return;
      busy.current = true;
      try {
        let value: ConversationPage | undefined;
        const pages = Math.max(1, offset.current / 20);
        let nextOffset = 0;
        for (let page = 0; page < pages; page++) {
          const next = await conversationClient.list(tenant, nextOffset, request.signal, trash);
          if (request.signal.aborted) return;
          value = value ? merge(value, next) : next;
          nextOffset += 20;
          if (!next.hasMore) break;
        }
        if (value) {
          offset.current = nextOffset;
          publish({ scope, value, loading: false });
        }
      } catch (error) {
        if (!request.signal.aborted && error instanceof IdentityError && [401, 403].includes(error.status)) {
          publish({ scope, error, loading: false });
          if (error.status === 401) expire();
        }
      } finally {
        if (!request.signal.aborted) busy.current = false;
      }
    };
    const trigger = () => {
      void refresh();
    };
    const timer = setInterval(trigger, 5000);
    window.addEventListener('focus', trigger);
    document.addEventListener('visibilitychange', trigger);
    window.addEventListener('conversation-list-changed', trigger);
    return () => {
      request.abort();
      clearInterval(timer);
      window.removeEventListener('focus', trigger);
      document.removeEventListener('visibilitychange', trigger);
      window.removeEventListener('conversation-list-changed', trigger);
    };
  }, [tenant, scope, trash, expire, publish, revision, session.identity]);

  const loadMore = useCallback(async () => {
    const previous = latest.current;
    if (busy.current || previous.scope !== scope || !previous.value?.hasMore) return;
    const request = new AbortController();
    controller.current = request;
    busy.current = true;
    publish({ ...previous, loading: true, moreError: undefined });
    try {
      const next = await conversationClient.list(tenant, offset.current, request.signal, trash);
      if (request.signal.aborted) return;
      offset.current += 20;
      publish({ scope, value: merge(previous.value, next), loading: false });
    } catch (error) {
      if (request.signal.aborted) return;
      if (error instanceof IdentityError && [401, 403].includes(error.status)) {
        publish({ scope, error, loading: false });
        if (error.status === 401) expire();
      } else publish({ ...previous, loading: false, moreError: error });
    } finally {
      if (!request.signal.aborted) busy.current = false;
    }
  }, [scope, tenant, expire, publish, trash]);
  useEffect(() => () => controller.current?.abort(), []);
  const visible: State = state.scope === scope ? state : { scope, loading: true };
  return { ...visible, loadMore };
}

export function ConversationListTail({
  hasMore,
  loading,
  error,
  blocked,
  loadMore,
}: {
  hasMore: boolean;
  loading: boolean;
  error?: unknown;
  blocked: boolean;
  loadMore: () => Promise<void>;
}) {
  const tail = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = tail.current;
    if (!element || !hasMore || loading || error || blocked) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { root: element.closest('.live-conversation-links'), rootMargin: '0px 0px 100px 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasMore, loading, error, blocked, loadMore]);
  return (
    <div ref={tail} className="live-conversation-list-tail" role="status">
      {loading ? (
        '正在加载会话…'
      ) : error ? (
        <Button variant="ghost" disabled={blocked} onClick={() => void loadMore()}>
          重试加载更多会话
        </Button>
      ) : null}
    </div>
  );
}

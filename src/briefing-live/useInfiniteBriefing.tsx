import { useEffect, useRef, useState, type DependencyList } from 'react';
import { useSession } from '../identity/session';
import { IdentityError } from '../identity/client';
import { requestNavigationLocked } from '../shared/request-guard';
import { Button } from '../shared/ui';

/** Revalidate every loaded page together; never retain revoked cards from an old page. */
export function useInfiniteBriefing<T extends { items: unknown[]; hasMore: boolean }>(
  load: (offset: number, previous: T | undefined, signal: AbortSignal) => Promise<T | null>,
  dependencies: DependencyList,
  identify: (item: T['items'][number]) => string,
  retainOnReload = false,
) {
  const { expire } = useSession();
  const [state, setState] = useState<{
    value?: T | null;
    error?: unknown;
    moreError?: unknown;
    loading: boolean;
  }>({ loading: true });
  const latest = useRef(state);
  latest.current = state;
  const action = useRef<(more: boolean) => Promise<void>>(async () => {});
  useEffect(() => {
    let controller: AbortController | undefined;
    let count = 1;
    let busy = false;
    setState((old) => ({ ...(retainOnReload ? { value: old.value } : {}), loading: true }));
    const read = async (more: boolean) => {
      if (more && (busy || !latest.current.value?.hasMore)) return;
      controller?.abort();
      const request = new AbortController();
      controller = request;
      busy = true;
      if (more) setState((s) => ({ ...s, loading: true, moreError: undefined }));
      try {
        let value: T | null | undefined = more ? latest.current.value : undefined;
        const target = more ? count + 1 : count;
        let loaded = more ? count : 0;
        for (let page = more ? count : 0; page < target; page++) {
          const next = await load(page * 20, value || undefined, request.signal);
          if (request.signal.aborted) return;
          loaded = page + 1;
          value =
            next && value
              ? {
                  ...next,
                  items: [
                    ...new Map(
                      [...value.items, ...next.items].map((item) => [identify(item), item]),
                    ).values(),
                  ],
                }
              : next;
          if (!next?.hasMore) break;
        }
        count = loaded;
        setState((old) =>
          JSON.stringify(old.value) === JSON.stringify(value) && !old.error && !old.loading
            ? old
            : { value, loading: false },
        );
      } catch (error) {
        if (request.signal.aborted) return;
        const denied = error instanceof IdentityError && [401, 403].includes(error.status);
        setState((old) =>
          more && !denied ? { ...old, moreError: error, loading: false } : { error, loading: false },
        );
        if (error instanceof IdentityError && error.status === 401) expire();
      } finally {
        if (!request.signal.aborted) busy = false;
      }
    };
    action.current = read;
    const focus = () => {
      if (!busy && !requestNavigationLocked()) void read(false);
    };
    const visible = () => {
      if (document.visibilityState === 'visible') focus();
    };
    void read(false);
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', visible);
    return () => {
      controller?.abort();
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [...dependencies, expire]);
  return { ...state, loadMore: () => action.current(true), reload: () => action.current(false) };
}

export function BriefingFeedTail({
  feed,
  blocked,
}: {
  feed: {
    value?: { hasMore: boolean } | null;
    loading: boolean;
    moreError?: unknown;
    loadMore: () => Promise<void>;
  };
  blocked: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || !feed.value?.hasMore || feed.loading || feed.moreError || blocked) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void feed.loadMore();
      },
      { root: ref.current.closest('main'), rootMargin: '0px 0px 180px 0px' },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [feed, blocked]);
  return (
    <div ref={ref} className="briefing-feed-tail" role="status">
      {feed.loading ? (
        '正在加载画报…'
      ) : feed.moreError ? (
        <Button disabled={blocked} onClick={() => void feed.loadMore()}>
          重试加载更多画报
        </Button>
      ) : null}
    </div>
  );
}

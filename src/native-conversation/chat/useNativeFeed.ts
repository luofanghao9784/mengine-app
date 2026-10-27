import { useEffect, useMemo, useRef, useState } from 'react';
import { isRootEvent, toNativeEvent, type NativeEvent } from './events.ts';
import { toStatus, type StatusEnvelope } from './status.ts';
import type { NativeChatActions, NativeSkill, NativeStatus } from './NativeChat';
import { nativeConversationClient as api } from '../client';
import { IdentityError } from '../../identity/client';
import { pendingOperation } from './pendingOperations.ts';

export type NativeFeed = {
  events: NativeEvent[];
  status?: NativeStatus;
  actions: NativeChatActions;
  /** Skills the employee may call with `/`; supplied by the platform's skill list (B5). */
  skills?: NativeSkill[];
  /** Ratings already given, by feedback key (platform seq of the rated reply). */
  ratings?: ReadonlyMap<string, 'up' | 'down'>;
  loading?: boolean;
  /** A load or connection problem; what has been shown so far stays on screen. */
  notice?: string;
  /** Synthetic development data; the page labels it so it is never mistaken for a real session. */
  preview: boolean;
};

const RETRY_MS = 5_000;

const message = (e: unknown) =>
  e instanceof IdentityError || e instanceof Error ? e.message : '操作未完成，请稍后重试。';

/**
 * Live feed for one native conversation (appendix C): cold history first, then the event stream
 * resumed from the last platform seq. Only the root session's events reach the conversation; status
 * reports are kept apart and go stale after 10 s. In local development, `nativePreview=1` in the
 * address loads synthetic events instead; production builds drop that branch.
 */
export function useNativeFeed(
  tenant: string,
  id: string,
  options: { enabled: boolean; active: boolean },
): NativeFeed | null {
  // Read on every render: the page re-renders on each address change, so removing the flag ends the preview.
  const preview =
    import.meta.env.DEV && id !== 'new' && new URLSearchParams(location.hash.slice(1)).has('nativePreview');
  const [previewFeed, setPreviewFeed] = useState<NativeFeed | null>(null);
  useEffect(() => {
    setPreviewFeed(null);
    if (!preview) return;
    let active = true;
    void import('./preview.ts').then(({ previewFeed }) => {
      if (active) previewFeed(setPreviewFeed);
    });
    return () => {
      active = false;
    };
  }, [tenant, id, preview]);
  const live = useLiveFeed(tenant, id, options.enabled && !preview && id !== 'new', options.active);
  return preview ? previewFeed : live;
}

function useLiveFeed(tenant: string, id: string, enabled: boolean, active: boolean): NativeFeed | null {
  const [events, setEvents] = useState<NativeEvent[]>([]);
  const [status, setStatus] = useState<StatusEnvelope | null>(null);
  const [ratings, setRatings] = useState<Map<string, 'up' | 'down'>>(new Map());
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const lastSeq = useRef(0);

  useEffect(() => {
    setEvents([]);
    setStatus(null);
    setRatings(new Map());
    setNotice('');
    setLoading(true);
    lastSeq.current = 0;
    if (!enabled) return;
    const controller = new AbortController();
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let pending: NativeEvent[] = [];
    let flush: ReturnType<typeof setTimeout> | undefined;
    // Each platform envelope is either a status report or a conversation event; drop the rest.
    const take = (raw: unknown) => {
      const event = toNativeEvent(raw);
      if (!event || event.seq <= lastSeq.current) return;
      lastSeq.current = event.seq;
      if (event.type === 'status') {
        if (event.data && typeof event.data === 'object')
          setStatus({ time: event.time, data: event.data as Record<string, unknown> });
        return;
      }
      if (!isRootEvent(event, id)) return;
      pending.push(event);
      // A reconnect can deliver 200 events at once; render them together.
      flush ??= setTimeout(() => {
        const batch = pending;
        pending = [];
        flush = undefined;
        setEvents((prior) => [...prior, ...batch]);
      }, 50);
    };
    const connect = () => {
      if (controller.signal.aborted) return;
      source = new EventSource(api.eventsHref(tenant, id, lastSeq.current));
      const receive = (e: MessageEvent<string>) => {
        try {
          take(JSON.parse(e.data));
          setNotice('');
        } catch {
          /* a malformed frame is skipped; the next one carries on */
        }
      };
      source.addEventListener('message', receive);
      source.addEventListener('status', receive as EventListener);
      source.onerror = () => {
        // The server ends each stream after 25 s and the browser reconnects with Last-Event-ID by
        // itself. Only a refused connection (closed) needs a new one, resumed from the last seq.
        if (source?.readyState !== EventSource.CLOSED) return;
        source = null;
        setNotice('与会话的连接中断，正在重新连接…');
        retry = setTimeout(connect, RETRY_MS);
      };
    };
    let reading = false;
    let historyReady = false;
    const readHistory = async () => {
      if (reading || historyReady || controller.signal.aborted) return;
      clearTimeout(retry);
      reading = true;
      try {
        for (;;) {
          const page = await api.history(tenant, id, lastSeq.current, controller.signal);
          if (controller.signal.aborted) return;
          page.items.forEach(take);
          if (!page.hasMore || !page.items.length) break;
        }
        historyReady = true;
        setLoading(false);
        setNotice('');
        connect();
      } catch (e) {
        if (controller.signal.aborted) return;
        setLoading(false);
        setNotice(`会话记录读取失败，正在重试：${message(e)}`);
        retry = setTimeout(() => void readHistory(), RETRY_MS);
      } finally {
        reading = false;
      }
    };
    const online = () => { if (!historyReady) void readHistory(); };
    window.addEventListener('online', online);
    void readHistory();
    api.ratings(tenant, id, controller.signal).then(
      (list) => setRatings(new Map(list.map((r) => [r.messageKey, r.value]))),
      () => undefined,
    );
    return () => {
      controller.abort();
      window.removeEventListener('online', online);
      source?.close();
      clearTimeout(retry);
      clearTimeout(flush);
    };
  }, [tenant, id, enabled]);

  // Re-evaluate freshness even when no new report arrives.
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), 2_000);
    return () => clearInterval(timer);
  }, [enabled]);

  const actions = useOperations(tenant, id, active, (key, value) =>
    setRatings((prior) => new Map(prior).set(key, value)),
  );
  return useMemo(
    () =>
      enabled
        ? {
            events,
            status: toStatus(status, now),
            actions,
            ratings,
            loading,
            notice: notice || undefined,
            preview: false,
          }
        : null,
    [enabled, events, status, now, actions, ratings, loading, notice],
  );
}

/**
 * Writes for one conversation. A requestId is kept per operation until it succeeds, so retrying the
 * same thing replays the first receipt instead of running twice; the server refuses to re-dispatch an
 * operation whose outcome is unknown, and the page then asks the employee to check the log first.
 */
function useOperations(
  tenant: string,
  id: string,
  active: boolean,
  rated: (key: string, value: 'up' | 'down') => void,
): NativeChatActions {
  return useMemo(() => {
    if (!active) return {};
    const once = <T>(op: string, run: (requestId: string) => Promise<T>) =>
      pendingOperation(tenant, id, op, run);
    return {
      async send(text, materials = []) {
        const refs = materials.map(({ materialId, versionId }) => ({ materialId, versionId }));
        await once(`send:${text}:${JSON.stringify(refs)}`, (r) => api.send(tenant, id, r, text, refs));
      },
      async stop() {
        // A stop is for the round running now; a later stop is a new operation.
        await once('stop', (r) => api.stopTurn(tenant, id, r));
      },
      async answer(callId, answers) {
        await once(`answer:${callId}:${JSON.stringify(answers)}`, (r) =>
          api.answer(tenant, id, callId, r, answers),
        );
      },
      async decide(approvalId, allow) {
        await once(`approval:${approvalId}:${allow}`, (r) => api.decide(tenant, id, approvalId, r, allow));
      },
      async review(callId, approve, comment) {
        await once(`plan:${callId}:${approve}:${comment ?? ''}`, (r) =>
          api.reviewPlan(tenant, id, callId, r, approve, comment),
        );
      },
      async feedback(messageKey, value) {
        await once(`feedback:${messageKey}:${value}`, (r) => api.rate(tenant, id, r, messageKey, value));
        rated(messageKey, value);
      },
    };
    // `rated` only updates local state; it does not need to rebuild the actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, id, active]);
}

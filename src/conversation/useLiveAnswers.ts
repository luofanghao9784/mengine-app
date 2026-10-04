import { useEffect, useState } from 'react';
import { record, uuid } from '../identity/client';
export type LiveAnswer = {
  taskId: string;
  attempt: number;
  step: number;
  version: number;
  text: string;
  state: 'STREAMING' | 'COMPLETE' | 'INTERRUPTED';
};
export function isLiveSnapshot(value: unknown): value is { items: LiveAnswer[] } {
  return (
    record(value) &&
    Array.isArray(value.items) &&
    value.items.length <= 20 &&
    value.items.every(
      (v) =>
        record(v) &&
        uuid(v.taskId) &&
        Number.isSafeInteger(v.attempt) &&
        Number(v.attempt) > 0 &&
        Number.isSafeInteger(v.step) &&
        Number(v.step) >= 1 &&
        Number(v.step) <= 8 &&
        Number.isSafeInteger(v.version) &&
        Number(v.version) > 0 &&
        typeof v.text === 'string' &&
        v.text.length <= 65536 &&
        ['STREAMING', 'COMPLETE', 'INTERRUPTED'].includes(String(v.state)),
    ) &&
    new Set(value.items.map((v) => v.taskId)).size === value.items.length
  );
}
export function useLiveAnswers(tenant: string, conversation: string | undefined, denied: () => void) {
  const key = `${tenant}/${conversation}`;
  const [data, setData] = useState<{ key: string; items: LiveAnswer[]; reconnecting: boolean }>({
    key: '',
    items: [],
    reconnecting: false,
  });
  useEffect(() => {
    setData({ key, items: [], reconnecting: false });
    if (!conversation || !uuid(conversation)) return;
    const base = `/api/v1/tenants/${tenant}/conversations/${conversation}`;
    const controller = new AbortController();
    let stopped = false,
      fallback = true,
      busy = false;
    let failedSince = 0;
    const accept = (value: unknown) => {
      if (!isLiveSnapshot(value) || stopped) return;
      setData({ key, items: value.items, reconnecting: false });
    };
    const stream = new EventSource(`${base}/answer-stream`);
    const deny = () => {
      stopped = true;
      stream.close();
      controller.abort();
      setData({ key, items: [], reconnecting: false });
      denied();
    };
    stream.addEventListener('answer', (event) => {
      try {
        accept(JSON.parse((event as MessageEvent).data));
      } catch {
        /* reconnect can recover from malformed data */
      }
    });
    stream.addEventListener('denied', deny);
    stream.onopen = () => {
      fallback = false;
      failedSince = 0;
      setData((old) => (old.key === key ? { ...old, reconnecting: false } : old));
    };
    stream.onerror = () => {
      fallback = true;
      void poll();
    };
    const poll = async () => {
      if (!fallback || busy || stopped) return;
      busy = true;
      let healthy = false;
      try {
        const response = await fetch(`${base}/answer-snapshot`, {
          credentials: 'same-origin',
          signal: controller.signal,
          cache: 'no-store',
        });
        if ([401, 403].includes(response.status)) {
          deny();
          return;
        }
        if (response.ok) {
          const value: unknown = await response.json();
          if (fallback && isLiveSnapshot(value)) {
            healthy = true;
            failedSince = 0;
            accept(value);
            return;
          }
        }
      } catch {
        /* retain visible text while the normal task poll checks service status */
      } finally {
        if (!stopped && fallback && !healthy) {
          if (!failedSince) failedSince = Date.now();
          else if (Date.now() - failedSince >= 3000)
            setData((old) => (old.key === key ? { ...old, reconnecting: true } : old));
        }
        busy = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 1500);
    return () => {
      stopped = true;
      stream.close();
      controller.abort();
      clearInterval(timer);
    };
  }, [tenant, conversation, key, denied]);
  return data.key === key ? data : { key, items: [], reconnecting: false };
}

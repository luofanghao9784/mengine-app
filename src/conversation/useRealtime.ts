import { useEffect, useState } from 'react';
import type { LiveSnapshot } from '../../contracts/public-api/conversation';
import { IdentityError } from '../identity/client';
import { liveClient } from './realtime-client';
export function useRealtime(tenant: string, conversation?: string) {
  const [snapshot, setSnapshot] = useState<LiveSnapshot>();
  const [disconnected, setDisconnected] = useState(false);
  const [denied, setDenied] = useState<IdentityError>();
  useEffect(() => {
    setSnapshot(undefined);
    setDenied(undefined);
    setDisconnected(false);
    if (!conversation) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    const update = (value: LiveSnapshot) => {
      if (!controller.signal.aborted) {
        setSnapshot((previous) => (JSON.stringify(previous) === JSON.stringify(value) ? previous : value));
        setDisconnected(false);
      }
    };
    const connect = async () => {
      try {
        await liveClient.stream(tenant, conversation, controller.signal, update);
        failures = 0;
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof IdentityError && [401, 403].includes(error.status)) {
          setSnapshot(undefined);
          setDenied(error);
          return;
        }
        setDisconnected(true);
        failures++;
        try {
          update(await liveClient.snapshot(tenant, conversation, controller.signal));
        } catch (fallback) {
          if (fallback instanceof IdentityError && fallback.status === 404) {
            setSnapshot(undefined);
            setDisconnected(false);
            return;
          }
          if (fallback instanceof IdentityError && [401, 403].includes(fallback.status)) {
            setSnapshot(undefined);
            setDenied(fallback);
            return;
          }
        }
      }
      if (!controller.signal.aborted)
        timer = setTimeout(connect, Math.min(10000, failures ? 1000 * 2 ** Math.min(3, failures - 1) : 300));
    };
    void connect();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [tenant, conversation]);
  return { snapshot: snapshot?.conversationId === conversation ? snapshot : undefined, disconnected, denied };
}

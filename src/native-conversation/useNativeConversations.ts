import { useEffect, useState } from 'react';
import type { NativeConversation } from '../../contracts/public-api/native-conversations';
import { nativeConversationClient as api } from './client';

/** Availability is a deployment fact; one lookup per tenant per page load is enough. */
const availability = new Map<string, Promise<boolean>>();
export function useNativeAvailability(tenant: string) {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let active = true;
    let lookup = availability.get(tenant);
    if (!lookup) {
      lookup = api.availability(tenant).then(
        (v) => v.enabled,
        () => false,
      );
      availability.set(tenant, lookup);
    }
    void lookup.then((v) => {
      if (active) setEnabled(v);
    });
    return () => {
      active = false;
    };
  }, [tenant]);
  return enabled;
}

/** Native sessions are listed per space by the server; collect them for the spaces the user can read. */
export function useNativeSessions(tenant: string, workspaceIds: string[], enabled: boolean, revision = 0) {
  const [state, setState] = useState<{ items: NativeConversation[]; error: unknown; loading: boolean }>({
    items: [],
    error: null,
    loading: false,
  });
  const key = workspaceIds.join(',');
  useEffect(() => {
    if (!enabled || !workspaceIds.length) {
      setState({ items: [], error: null, loading: false });
      return;
    }
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true }));
    Promise.all(workspaceIds.map((id) => api.list(tenant, id, controller.signal))).then(
      (lists) =>
        setState({
          items: lists.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
          error: null,
          loading: false,
        }),
      (error) => {
        if (!controller.signal.aborted) setState({ items: [], error, loading: false });
      },
    );
    return () => controller.abort();
  }, [tenant, key, enabled, revision]);
  return state;
}

export const nativeHref = (tenant: string, id: string, extra: Record<string, string> = {}) =>
  '#' + new URLSearchParams({ tenant, view: 'conversations', native: id, ...extra });

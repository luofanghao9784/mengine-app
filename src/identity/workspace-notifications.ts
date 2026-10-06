import { useEffect, useState } from 'react';
import { createIdentityRequest, IdentityError, record, uuid } from './client';
import { useSession } from './session';

export type WorkspaceNotifications = { tenantId: string; conversations: boolean; briefing: boolean };
const request = createIdentityRequest();
import { notificationEvent } from './workspace-notification-events';
export function useWorkspaceNotifications(tenant: string, enabled: boolean, routeKey: string, account: string) {
  const { expire } = useSession();
  const [state, setState] = useState<WorkspaceNotifications & { account: string }>();
  useEffect(() => {
    if (!enabled || !uuid(tenant)) { setState(undefined); return; }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let busy = false;
    let again = false;
    const read = async () => {
      if (controller.signal.aborted || document.visibilityState === 'hidden') return;
      if (busy) { again = true; return; }
      busy = true;
      clearTimeout(timer);
      try {
        const value = await request(`/api/v1/tenants/${tenant}/workspace/notifications`, 'GET',
          (v): v is WorkspaceNotifications => record(v) && v.tenantId === tenant &&
            typeof v.conversations === 'boolean' && typeof v.briefing === 'boolean', undefined, controller.signal);
        if (!controller.signal.aborted) setState({ ...value, account });
      } catch (e) {
        if (!controller.signal.aborted && e instanceof IdentityError && [401, 403, 404].includes(e.status)) {
          setState(undefined);
          if (e.status === 401) expire();
        }
      } finally {
        busy = false;
        if (!controller.signal.aborted) {
          if (again) { again = false; void read(); }
          else timer = setTimeout(read, 5000);
        }
      }
    };
    const invalidate = (event: Event) => {
      if (!(event instanceof CustomEvent) || event.detail === tenant) void read();
    };
    void read();
    window.addEventListener('focus', invalidate);
    document.addEventListener('visibilitychange', invalidate);
    window.addEventListener(notificationEvent, invalidate);
    return () => {
      controller.abort();clearTimeout(timer);
      window.removeEventListener('focus', invalidate);
      document.removeEventListener('visibilitychange', invalidate);
      window.removeEventListener(notificationEvent, invalidate);
    };
  }, [tenant, enabled, routeKey, account, expire]);
  return enabled && state?.tenantId === tenant && state.account === account ? state : undefined;
}

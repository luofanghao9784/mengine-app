import { reconcileViewStates } from '../shared/view-state';
import { reconcileDocumentDrafts } from '../documents/drafts';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Identity } from '../../contracts/public-api/identity';
import { createIdentityClient, IdentityError } from './client';

export const identityClient = createIdentityClient();
type Session = {
  phase: 'loading' | 'anonymous' | 'authenticated' | 'unavailable';
  identity: Identity | null;
};
const SessionContext = createContext<{
  session: Session;
  refresh: (background?: boolean) => Promise<void>;
  login: (phone: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  expire: () => void;
  authenticated: (identity: Identity) => void;
} | null>(null);
const CHANGE_KEY = 'dreamcore-session-change';

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>({ phase: 'loading', identity: null });
  const generation = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const current = useRef(session);
  current.current = session;
  const invalidate = useCallback(() => {
    generation.current++;
    pending.current?.abort();
  }, []);
  const expire = useCallback(() => {
    invalidate();
    reconcileDocumentDrafts(null);
    reconcileViewStates(null);
    setSession({ phase: 'anonymous', identity: null });
    notify();
  }, [invalidate]);
  const notify = () => {
    channel.current?.postMessage('changed');
    // Only an invalidation marker, never account data, cookies, passwords or tokens.
    try {
      localStorage.setItem(CHANGE_KEY, crypto.randomUUID());
    } catch {
      /* Focus revalidation still works. */
    }
  };
  const refresh = useCallback(
    async (background = false) => {
      invalidate();
      const id = generation.current;
      const controller = new AbortController();
      pending.current = controller;
      if (!background) setSession({ phase: 'loading', identity: null });
      try {
        const identity = await identityClient.me(controller.signal);
        if (id === generation.current) {
          reconcileDocumentDrafts(identity);
          reconcileViewStates(
            identity.account.id,
            identity.memberships.map((m) => m.tenantId),
          );
          setSession((previous) =>
            previous.phase === 'authenticated' &&
            JSON.stringify(previous.identity) === JSON.stringify(identity)
              ? previous
              : { phase: 'authenticated', identity },
          );
        }
      } catch (error) {
        if (id !== generation.current) return;
        if (error instanceof IdentityError && error.status === 401) {
          reconcileDocumentDrafts(null);
          reconcileViewStates(null);
        }
        setSession({
          phase: error instanceof IdentityError && error.status === 401 ? 'anonymous' : 'unavailable',
          identity: null,
        });
      }
    },
    [invalidate],
  );
  useEffect(() => {
    void refresh();
    if ('BroadcastChannel' in window) {
      channel.current = new BroadcastChannel(CHANGE_KEY);
      channel.current.onmessage = () => void refresh();
    }
    const storage = (event: StorageEvent) => {
      if (event.key === CHANGE_KEY) void refresh();
    };
    const focus = () => {
      if (current.current.phase === 'authenticated') void refresh(true);
    };
    window.addEventListener('storage', storage);
    window.addEventListener('focus', focus);
    return () => {
      invalidate();
      channel.current?.close();
      channel.current = null;
      window.removeEventListener('storage', storage);
      window.removeEventListener('focus', focus);
    };
  }, [refresh, invalidate]);
  const authenticated = (identity: Identity) => {
    invalidate();
    reconcileDocumentDrafts(identity);
    reconcileViewStates(
      identity.account.id,
      identity.memberships.map((m) => m.tenantId),
    );
    setSession({ phase: 'authenticated', identity });
    notify();
  };
  const login = async (phone: string, password: string) => {
    invalidate();
    const id = generation.current;
    const identity = await identityClient.login(phone, password);
    if (id === generation.current) {
      reconcileDocumentDrafts(identity);
      reconcileViewStates(
        identity.account.id,
        identity.memberships.map((m) => m.tenantId),
      );
      setSession({ phase: 'authenticated', identity });
    } else await refresh();
    notify();
  };
  const logout = async () => {
    // Drop rendered business state immediately, even if transport cannot confirm logout.
    reconcileDocumentDrafts(null);
    reconcileViewStates(null);
    invalidate();
    setSession({ phase: 'loading', identity: null });
    try {
      await identityClient.logout();
      expire();
      notify();
    } catch (error) {
      if (error instanceof IdentityError && error.status === 401) {
        expire();
        notify();
        return;
      }
      setSession({ phase: 'unavailable', identity: null });
      notify();
      throw error;
    }
  };
  return (
    <SessionContext.Provider value={{ session, refresh, login, logout, expire, authenticated }}>
      {children}
    </SessionContext.Provider>
  );
}
export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('SessionProvider required');
  return value;
}

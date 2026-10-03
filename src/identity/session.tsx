import { reconcileViewStates } from '../shared/view-state';
import { reconcileDocumentDrafts } from '../documents/drafts';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Identity } from '../../contracts/public-api/identity';
import { createIdentityClient, createIdentityRequest, isIdentity, IdentityError } from './client';

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
const platformRequest = createIdentityRequest();
const platformIdentityClient = {
  me: (signal?: AbortSignal) => platformRequest('/api/platform-admin/v1/auth/me', 'GET', isIdentity, undefined, signal),
  login: (username: string, password: string) => platformRequest('/api/platform-admin/v1/auth/login', 'POST', isIdentity, {username, password}),
  logout: () => platformRequest('/api/platform-admin/v1/auth/logout', 'POST', (v): v is null => v === null),
};

export function SessionProvider({ children, realm = 'customer' }: { children: ReactNode; realm?: 'customer' | 'platform' }) {
  const client = realm === 'platform' ? platformIdentityClient : identityClient;
  const CHANGE_KEY = realm === 'platform' ? 'dreamcore-platform-session-change' : 'dreamcore-session-change';
  const reconcile = useCallback((identity: Identity | null) => {
    if (realm === 'platform') return;
    reconcileDocumentDrafts(identity);
    reconcileViewStates(identity?.account.id ?? null, identity?.memberships.map((m) => m.tenantId));
  }, [realm]);
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
    reconcile(null);
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
        const identity = await client.me(controller.signal);
        if (id === generation.current) {
          reconcile(identity);
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
          reconcile(null);
        }
        setSession({
          phase: error instanceof IdentityError && error.status === 401 ? 'anonymous' : 'unavailable',
          identity: null,
        });
      }
    },
    [invalidate, reconcile, client],
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
    reconcile(identity);
    setSession({ phase: 'authenticated', identity });
    notify();
  };
  const login = async (phone: string, password: string) => {
    invalidate();
    const id = generation.current;
    const identity = await client.login(phone, password);
    if (id === generation.current) {
      reconcile(identity);
      setSession({ phase: 'authenticated', identity });
    } else await refresh();
    notify();
  };
  const logout = async () => {
    // Drop rendered business state immediately, even if transport cannot confirm logout.
    reconcile(null);
    invalidate();
    setSession({ phase: 'loading', identity: null });
    try {
      await client.logout();
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

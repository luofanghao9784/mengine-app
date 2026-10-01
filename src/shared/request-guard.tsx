import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

const navigationLocks = new Set<symbol>();
export const requestNavigationLocked = () => navigationLocks.size > 0;

const RequestLocks = createContext<(key: symbol, locked: boolean) => void>(() => {});
export const RequestPending = createContext(false);

/** Keep an uncertain write mounted until the user retries its original request. */
export function RequestGuard({ children }: { children: ReactNode }) {
  const [locks, setLocks] = useState<Set<symbol>>(() => new Set());
  const pending = locks.size > 0;
  const acceptedHash = useRef(location.hash);
  const register = useCallback((key: symbol, locked: boolean) => {
    if (locked) navigationLocks.add(key); else navigationLocks.delete(key);
    setLocks(previous => {
      if (previous.has(key) === locked) return previous;
      const next = new Set(previous);
      if (locked) next.add(key); else next.delete(key);
      return next;
    });
  }, []);
  useEffect(() => {
    if (!pending) acceptedHash.current = location.hash;
    const navigate = (event: HashChangeEvent) => {
      if (!pending) { acceptedHash.current = location.hash; return; }
      history.replaceState(null, '', location.pathname + location.search + acceptedHash.current);
      event.stopImmediatePropagation();
    };
    const leave = (event: BeforeUnloadEvent) => { if (pending) event.preventDefault(); };
    window.addEventListener('hashchange', navigate, true);
    window.addEventListener('beforeunload', leave);
    return () => {
      window.removeEventListener('hashchange', navigate, true);
      window.removeEventListener('beforeunload', leave);
    };
  }, [pending]);
  return <RequestLocks.Provider value={register}><RequestPending.Provider value={pending}>
    <div onClickCapture={event => {
      if (pending && event.target instanceof Element && event.target.closest('a[href]')) {
        event.preventDefault(); event.stopPropagation();
      }
    }}>{children}</div>
  </RequestPending.Provider></RequestLocks.Provider>;
}

export function useRequestLock(locked: boolean) {
  const register = useContext(RequestLocks), key = useRef(Symbol('request'));
  useEffect(() => { register(key.current, locked); return () => register(key.current, false); }, [register, locked]);
}

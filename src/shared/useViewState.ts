import { useCallback, useLayoutEffect, useRef, useState, type SetStateAction, type RefObject } from 'react';
import { useSession } from '../identity/session';
import { readViewState, viewStateKey, writeViewState } from './view-state';

/** Tab-local UI state only. Bodies, authorization and mutation receipts are never restored here. */
export function useViewState<T>(
  tenant: string,
  page: string,
  fallback: T,
  valid: (value: unknown) => value is T,
) {
  const { session } = useSession();
  const key = viewStateKey(session.identity!.account.id, tenant, page);
  const [state, update] = useState(() => ({ key, value: readViewState(key, fallback, valid) }));
  const value = state.key === key ? state.value : readViewState(key, fallback, valid);
  const options = useRef({ key, fallback, valid });
  options.current = { key, fallback, valid };
  const set = useCallback((next: SetStateAction<T>) => {
    update((previous) => {
      const { key, fallback, valid } = options.current;
      const old = previous.key === key ? previous.value : readViewState(key, fallback, valid);
      const value = typeof next === 'function' ? (next as (value: T) => T)(old) : next;
      writeViewState(key, value);
      return { key, value };
    });
  }, []);
  return [value, set] as const;
}

export const textState = (v: unknown): v is string => typeof v === 'string' && v.length <= 2000;
export const pageState = (v: unknown): v is number =>
  Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= 1000;

/** Wait for asynchronous readers to populate before restoring scroll; never restore their HTML. */
export function useViewScroll(ref: RefObject<HTMLElement | null>, tenant: string, page: string) {
  const { session } = useSession();
  const key = viewStateKey(session.identity!.account.id, tenant, 'scroll:' + page);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const saved = readViewState<Record<string, number>>(
      key,
      {},
      (v): v is Record<string, number> =>
        !!v &&
        typeof v === 'object' &&
        Object.values(v).every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0),
    );
    const pending = new Map(Object.entries(saved));
    let restoring = true;
    const nodes = () => [root, ...root.querySelectorAll<HTMLElement>('[data-scroll-key]')];
    const id = (node: HTMLElement) => (node === root ? 'root' : node.dataset.scrollKey!);
    const restore = () => {
      for (const node of nodes()) {
        const value = pending.get(id(node));
        if (value === undefined) continue;
        if (node.scrollHeight - node.clientHeight >= value) {
          node.scrollTop = value;
          pending.delete(id(node));
        }
      }
    };
    const observer = new MutationObserver(restore);
    observer.observe(root, { childList: true, subtree: true });
    restore();
    const timer = setTimeout(() => {
      restoring = false;
      observer.disconnect();
    }, 5000);
    const cancel = () => {
      restoring = false;
      observer.disconnect();
      pending.clear();
    };
    const save = () => {
      const values = Object.fromEntries(nodes().map((node) => [id(node), node.scrollTop]));
      if (restoring) for (const [name, value] of pending) values[name] = value;
      writeViewState(key, values);
    };
    root.addEventListener('scroll', save, true);
    root.addEventListener('wheel', cancel, { passive: true });
    root.addEventListener('touchstart', cancel, { passive: true });
    window.addEventListener('pagehide', save);
    return () => {
      save();
      clearTimeout(timer);
      observer.disconnect();
      root.removeEventListener('scroll', save, true);
      root.removeEventListener('wheel', cancel);
      root.removeEventListener('touchstart', cancel);
      window.removeEventListener('pagehide', save);
    };
  }, [key]);
}

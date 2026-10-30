import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRemote } from '../../shared/admin';
import './section-kit.css';

/**
 * 成员与权限、用量与运行、企业信息、经验库四个板块共用的小部件：
 * 与数据底座、知识星链同一套“清单卡 + 详情卡 + 概况卡”。
 */

/** 板块内的栏目与选中项记在地址 hash 里：刷新回原处，链接可分享。 */
export function useHashParams() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const write = (patch: Record<string, string | null>, push = false) => {
    const params = new URLSearchParams(location.hash.slice(1));
    for (const [key, value] of Object.entries(patch))
      if (value === null) params.delete(key);
      else params.set(key, value);
    const next = '#' + params;
    if (next === location.hash) return;
    if (push) location.hash = next;
    else {
      history.replaceState(history.state, '', next);
      setHash(next);
    }
  };
  return [new URLSearchParams(hash.slice(1)), write, hash] as const;
}

/**
 * 按 20 条一页读取，“加载更多”时把后面的页接上。
 * 接口返回数组时多返回一条表示还有下一页；返回 { items, hasMore } 时按 hasMore，第一页的其余字段作为 meta。
 */
type Page<T, M> = T[] | ({ items: T[]; hasMore: boolean } & M);
export function usePaged<T, M = object>(load: (offset: number, signal: AbortSignal) => Promise<Page<T, M>>, deps: unknown[]) {
  const [pages, setPages] = useState(1);
  const key = JSON.stringify(deps);
  const last = useRef(key);
  if (last.current !== key) {
    last.current = key;
    if (pages !== 1) setPages(1);
  }
  const remote = useRemote(
    async (signal) => {
      const items: T[] = [];
      let meta: M | undefined;
      for (let p = 0; p < pages; p++) {
        const batch = await load(p * 20, signal);
        if (Array.isArray(batch)) {
          items.push(...batch.slice(0, 20));
          if (batch.length <= 20) return { items, more: false, meta };
        } else {
          if (p === 0) meta = batch;
          items.push(...batch.items);
          if (!batch.hasMore) return { items, more: false, meta };
        }
      }
      return { items, more: true, meta };
    },
    [key, pages],
  );
  return { ...remote, more: () => setPages((n) => n + 1) };
}

/** 输入停顿后再查询，免得每个字都请求一次。 */
export function useDebounced(value: string, ms = 300) {
  const [v, set] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => set(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e || '读取失败'));

/** 清单卡标题行：左边是标题，右上角是搜索等小工具。 */
export function ListHead({
  title,
  search,
  placeholder = '搜索',
  children,
}: {
  title: string;
  search?: [string, (q: string) => void];
  placeholder?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = search || ['', () => {}];
  return (
    <header className="list-head">
      {search && (open || q) ? (
        <input
          className="head-search"
          autoFocus
          maxLength={120}
          placeholder={placeholder}
          aria-label={placeholder}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onBlur={() => !q && setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setQ('');
              setOpen(false);
            }
          }}
        />
      ) : (
        <h2>{title}</h2>
      )}
      <span className="head-tools">
        {children}
        {search && (
          <button
            type="button"
            className="icon"
            title={open || q ? '清除搜索' : '搜索'}
            aria-label={open || q ? '清除搜索' : '搜索'}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (open || q) {
                setQ('');
                setOpen(false);
              } else setOpen(true);
            }}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              {open || q ? (
                <path d="M4 4l8 8M12 4l-8 8" />
              ) : (
                <>
                  <circle cx="7" cy="7" r="4.5" />
                  <path d="M10.5 10.5 14 14" />
                </>
              )}
            </svg>
          </button>
        )}
      </span>
    </header>
  );
}

/** 清单的读取状态、空状态与“加载更多”。 */
export function ListBody<T>({
  remote,
  empty,
  children,
}: {
  remote: { value?: { items: T[]; more: boolean }; error?: unknown; more: () => void };
  empty: string;
  children: (items: T[]) => ReactNode;
}) {
  if (remote.error) return <p className="none">{errorText(remote.error)}</p>;
  if (!remote.value) return <p className="none">正在读取…</p>;
  if (!remote.value.items.length) return <p className="none">{empty}</p>;
  return (
    <>
      {children(remote.value.items)}
      {remote.value.more && (
        <button type="button" className="chip more-rows" onClick={remote.more}>
          加载更多
        </button>
      )}
    </>
  );
}

/** 右侧概况卡：一组“名称—数字”。 */
export function Facts({ title, rows }: { title: string; rows: [string, ReactNode][] }) {
  return (
    <article className="card facts">
      <header>
        <h2>{title}</h2>
      </header>
      {rows.map(([label, value]) => (
        <div key={label} className="fact">
          <span>{label}</span>
          <b className={value == null || /^[\d,.\s%]+$/.test(String(value)) ? 'num' : 'text'}>{value ?? '—'}</b>
        </div>
      ))}
    </article>
  );
}

/** 栏目页签：放在清单卡（或宽卡）顶部。 */
export function SectionTabs<K extends string>({
  tabs,
  active,
  onChange,
  label,
}: {
  tabs: [K, string, number?][];
  active: K;
  onChange: (k: K) => void;
  label: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map(([id, name, count]) => (
        <button key={id} type="button" role="tab" aria-selected={active === id} onClick={() => onChange(id)}>
          {name}
          {count != null && <span className="num"> {count}</span>}
        </button>
      ))}
    </div>
  );
}

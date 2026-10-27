import { knowledgeProjection } from './knowledge-projection';
import { companySourceClient } from '../../profile/company-source-client';
import { useRemote } from '../../shared/admin';
import { useSession } from '../../identity/session';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, date } from './foundation-api';
import type { Item } from './data';
export type KnowledgeSnapshot = {
  items: Item[];
  relations: [string, string, string][];
  sourceKind: Record<string, number>;
  tabs: { label: string; items: Item[] }[];
  stats: { title: string; rows: [string, string, string?][] };
  aside: { title: string; rows: [string, string][] };
  business?: { pending: number; failed: number; learned: number; withoutFindings: number };
  pipeline?: { steps: {stage: string; source: string; state: string; reason: string; message: string}[]; waiting: number; failed: number; busy: boolean };
  pending: number;
  failed: number;
  busy: boolean;
  available: boolean;
  needsGraph: boolean;
  scopeRevision: string;
  status: string;
};
export function useKnowledge(active: boolean, tenant?: string | null) {
  const { session } = useSession();
  const [backgroundTick, refreshBackground] = useState(0);
  const background = useRemote(signal => tenant ? companySourceClient.knowledge(tenant, signal) : Promise.resolve(null), [tenant, active, session.identity, backgroundTick]);
  const [rawData, setRawData] = useState<KnowledgeSnapshot | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const alive = useRef(false),
    working = useRef(false),
    syncing = useRef(false),
    again = useRef(false),
    epoch = useRef(0),
    last = useRef('');
  // 内容没变就沿用旧对象，3D 星图和清单不重建。
  const setData = (next: KnowledgeSnapshot | null) => {
    const text = next ? JSON.stringify(next) : '';
    if (text === last.current) return;
    last.current = text;
    setRawData(next);
  };
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const syncRef = useRef(sync);
  syncRef.current = sync;
  /** 只读刷新：打开知识星链、定时轮询都只读，不触发同步。 */
  async function refresh() {
    // 正在读时又要读（比如刚同步完）：等这次读完再读一次，免得显示同步前的状态。
    if (working.current) {
      again.current = true;
      return;
    }
    working.current = true;
    const ticket = epoch.current;
    const valid = () => alive.current && ticket === epoch.current;
    try {
      const next = await api<KnowledgeSnapshot>('/scene-knowledge');
      if (!valid()) return;
      setData(next);
      setError('');
    } catch (e) {
      if (valid()) {
        if ([401, 403, 404, 410].includes((e as { status?: number }).status ?? 0)) setData(null);
        setError((e as Error).message);
      }
    } finally {
      working.current = false;
      if (again.current && valid()) {
        again.current = false;
        void refreshRef.current();
      }
    }
  }
  /** 同步（写操作）：只由界面上的按钮触发；retry 为真时连同失败项一起重试。 */
  async function sync(retry = false) {
    if (syncing.current) return;
    syncing.current = true;
    const ticket = epoch.current;
    const valid = () => alive.current && ticket === epoch.current;
    setBusy(true);
    try {
      await api('/scene-knowledge/sync', { retry });
      if (!valid()) return;
      setError('');
    } catch (e) {
      if (valid()) {
        if ([401, 403, 404, 410].includes((e as { status?: number }).status ?? 0)) setData(null);
        setError((e as Error).message);
      }
    } finally {
      syncing.current = false;
      if (valid()) setBusy(false);
      // 无论成败都再读一次，显示同步后的实际状态。
      if (valid()) void refreshRef.current();
    }
  }
  useEffect(() => {
    alive.current = true;
    void refresh();
    const t = setInterval(() => {
      if (document.visibilityState !== 'hidden') void refreshRef.current();
    }, 15000);
    const visible = () => {
      if (document.visibilityState === 'visible') void refreshRef.current();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      alive.current = false;
      epoch.current++;
      clearInterval(t);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);
  useEffect(() => {
    if (active) void refresh();
  }, [active]);
  // 企业背景单独作为治理上下文展示，不能在浏览器端虚增已发布知识。
  const data = useMemo(() => rawData ? knowledgeProjection(rawData) : rawData, [rawData]);
  const stableRefresh = useCallback(() => refreshRef.current(), []);
  const stableSync = useCallback((retry?: boolean) => syncRef.current(retry), []);
  const stableRefreshBackground = useCallback(() => refreshBackground((n) => n + 1), []);
  // 返回同一个对象，直到知识、错误或同步状态真的变了；知识按编号建索引，关联查询不再逐条遍历。
  return useMemo(() => {
    const names = new Map((data?.items || []).map((k) => [k.id, k.name]));
    const links = new Map<string, { id: string; why: string; name: string }[]>();
    for (const [a, b, why] of data?.relations || []) {
      for (const [from, to] of a === b ? [[a, b]] : [[a, b], [b, a]]) {
        const list = links.get(from) || [];
        // 同一对知识可能被登记了两次（A→B 和 B→A）：关联清单里只列一次。
        if (!list.some((x) => x.id === to)) list.push({ id: to, why, name: names.get(to) || '' });
        links.set(from, list);
      }
    }
    const empty = {
      id: '',
      group: '知识星链',
      name: error ? '知识服务暂不可用' : data?.status || '正在读取知识',
      why: '',
      side: '',
      tone: 'plain',
      verdict: error || data?.status || '正在校验当前授权范围',
      kvHead: ['项', '内容', '状态'],
      kv: [],
      actions: ['重新核验'],
    } as Item;
    return {
      data,
      ids: new Set(names.keys()),
      backgroundError: background.error,
      refreshBackground: stableRefreshBackground,
      error,
      busy,
      refresh: stableRefresh,
      sync: stableSync,
      empty,
      tabs:
        data?.tabs ||
        ['全部', '来源待处理', '结构化数据', '非结构化资料', '共享空间上传'].map((label) => ({
          label: label + ' —',
          items: [] as Item[],
        })),
      stats: data?.stats || { title: '知识构成', rows: [] },
      aside: {
        title: '最近入库',
        rows: (data?.aside.rows || []).map(([name, at]) => [name, date(at)] as [string, string]),
      },
      related: (id: string) => links.get(id) || [],
    };
  }, [data, error, busy, background.error, stableRefresh, stableSync, stableRefreshBackground]);
}
export type Knowledge = ReturnType<typeof useKnowledge>;

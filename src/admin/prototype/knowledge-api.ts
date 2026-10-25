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
    enabled = useRef(active),
    stopped = useRef(false),
    epoch = useRef(0),
    last = useRef('');
  enabled.current = active;
  // 内容没变就沿用旧对象，3D 星图和清单不重建。
  const setData = (next: KnowledgeSnapshot | null) => {
    const text = next ? JSON.stringify(next) : '';
    if (text === last.current) return;
    last.current = text;
    setRawData(next);
  };
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  async function refresh(retry = false) {
    if (working.current) return;
    working.current = true;
    const ticket = epoch.current;
    const valid = () => alive.current && ticket === epoch.current;
    try {
      if (retry) stopped.current = false;
      let next = await api<KnowledgeSnapshot>('/scene-knowledge');
      if (!valid()) return;
      setData(next);
      setError('');
      if (
        enabled.current &&
        !stopped.current &&
        next.available &&
        !next.busy &&
        (next.pending || (retry && next.failed) || next.needsGraph)
      ) {
        setBusy(true);
        await api('/scene-knowledge/sync', { retry });
        if (!valid()) return;
        next = await api<KnowledgeSnapshot>('/scene-knowledge');
        if (valid()) setData(next);
      }
    } catch (e) {
      if (valid()) {
        stopped.current = true;
        setError((e as Error).message);
        if ([401, 403, 404, 410].includes((e as { status?: number }).status ?? 0)) {
          setData(null);
          return;
        }
        try {
          const latest = await api<KnowledgeSnapshot>('/scene-knowledge');
          if (valid()) {
            setData(latest);
            stopped.current = !(latest.business && latest.business.pending > 0);
          }
        } catch (retryError) {
          // 仅临时读取失败保留知识；权限或资源失效必须清空。
          if ([401, 403, 404, 410].includes((retryError as { status?: number }).status ?? 0)) setData(null);
        }
      }
    } finally {
      working.current = false;
      if (valid()) setBusy(false);
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
  const data = useMemo(() => {
    if (!rawData) return rawData;
    const entries = background.value?.items || [];
    if (!entries.length) return rawData.tabs.length ? rawData : { ...rawData, tabs: [{label: `全部 ${rawData.items.length}`, items: rawData.items}] };
    const id = `company-background:${tenant}`;
    const item: Item = { id, name: '企业背景', group: '企业背景知识', why: `${entries.length} 项背景 · 引用企业信息原版本`, side: '结构化引用', tone: 'plain', verdict: '来源可读；不代表 AI 分析或检索索引已完成。', kvHead: ['项','内容','状态'], kv: [], actions: [] };
    const tabs = rawData.tabs.map((tab, i) => i === 0 ? { ...tab, label: `全部 ${tab.items.length + 1}`, items: [item, ...tab.items] } : tab);
    if (!tabs.length) tabs.push({label: '全部 1', items: [item]});
    tabs.push({ label: '企业背景 1', items: [item] });
    return { ...rawData, items: [item, ...rawData.items], tabs,
      status: `共 ${rawData.items.length + 1} 条知识（含 1 条企业背景）`,
      stats: {...rawData.stats, rows: [['知识总数', String(rawData.items.length + 1)], ['企业背景', '1'], ...rawData.stats.rows] as [string,string,string?][] } };
  }, [rawData, background.value, tenant]);
  const stableRefresh = useCallback((retry?: boolean) => refreshRef.current(retry), []);
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
      empty,
      tabs:
        data?.tabs ||
        ['全部', '需要留意', '来自业务数据', '来自资料', '来自会话'].map((label) => ({
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
  }, [data, error, busy, background.error, stableRefresh, stableRefreshBackground]);
}
export type Knowledge = ReturnType<typeof useKnowledge>;

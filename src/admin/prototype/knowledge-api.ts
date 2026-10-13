import { useEffect, useRef, useState } from 'react';
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
export function useKnowledge(active: boolean) {
  const [data, setData] = useState<KnowledgeSnapshot | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const alive = useRef(false),
    working = useRef(false),
    enabled = useRef(active),
    stopped = useRef(false),
    epoch = useRef(0);
  enabled.current = active;
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
        try {
          const latest = await api<KnowledgeSnapshot>('/scene-knowledge');
          if (valid()) {
            setData(latest);
            stopped.current = !(latest.business && latest.business.pending > 0);
          }
        } catch {
          if (valid()) setData(null);
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
    const t = setInterval(() => void refresh(), 15000);
    return () => {
      alive.current = false;
      epoch.current++;
      clearInterval(t);
    };
  }, []);
  useEffect(() => {
    if (active) void refresh();
  }, [active]);
  const empty = {
    id: '',
    group: '知识库',
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
    error,
    busy,
    refresh,
    empty,
    tabs:
      data?.tabs ||
      ['全部', '需要留意', '来自业务数据', '来自资料', '来自会话'].map((label) => ({
        label: label + ' —',
        items: [] as Item[],
      })),
    stats: data?.stats || { title: '知识构成', rows: [] },
    aside: { title: '最近入库', rows: (data?.aside.rows || []).map(([name, at]) => [name, date(at)]) },
    related: (id: string) =>
      (data?.relations || [])
        .filter(([a, b]) => a === id || b === id)
        .map(([a, b, why]) => ({
          id: a === id ? b : a,
          why,
          name: data?.items.find((k) => k.id === (a === id ? b : a))?.name || '',
        })),
  };
}
export type Knowledge = ReturnType<typeof useKnowledge>;

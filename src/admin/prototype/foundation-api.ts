import { useCallback, useEffect, useRef, useState } from 'react';
import type { Tone, Item } from './data';
export type Asset = {
  id: string;
  title: string;
  department: string;
  kind: 'table' | 'document';
  sourceKind: number;
  source: string;
  status: string;
  label: string;
  gate: number;
  available: boolean;
  needsAttention: boolean;
  checksPassed: boolean;
  paused: boolean;
  version: number;
  policyVersion: number;
  updatedAt: string;
  reviewAt: string;
  quality: number;
  classification: number;
  issues: string[];
  tags: string[];
  total: number | null;
  ready: number | null;
  isolated: number;
  fieldCount: number;
  dictionaryStatus: string | null;
  actions: string[];
  tone: Tone;
  updatePolicy: string;
  sync: {
    id: string;
    enabled: boolean;
    state: string;
    intervalMinutes: number;
    nextAt: string;
    lastSuccess: string | null;
    error: string;
  } | null;
};
export type Snapshot = {
  at: string;
  user: { name: string; role: string };
  tenant: { name: string };
  model: { configured: boolean; enabled: boolean; model: string };
  items: Asset[];
  passed: number[];
  sources: { name: string; count: number }[];
  auditValid: boolean;
  governance: {
    attention: number;
    isolated: number;
    overdue: number;
    failed: number;
    averageQuality: number | null;
    departments: { name: string; total: number; attention: number }[];
  };
  canScan: boolean;
};
export type Finding = {
  id: string;
  kind: string;
  title: string;
  detail: string;
  count: number;
  field?: string;
  status: string;
  manuallyApproved?: boolean;
  firstAt: string;
  lastAt: string;
  history: { at: string; actor: string; action: string; note: string }[];
};
export type Detail = {
  analysis: {
    state: string;
    model: string;
    available: boolean;
    report: {
      createdAt: string;
      overview: string;
      findings: { title: string; severity: string; explanation: string; recommendation: string }[];
    } | null;
  } | null;
  asset: Asset;
  audit: { at: string; actor: string; action: string; detail: string }[];
  dictionary: null | {
    status: string;
    current: boolean;
    revision: number;
    at: string | null;
    provider: string;
    tableMeaning: string;
    usageRules: string;
    warnings: string[];
    job: { state: string; attempts: number; nextAt: string; error: string } | null;
    fields: {
      name: string;
      label: string;
      type: string;
      required: boolean;
      unique: boolean;
      sensitive: boolean;
      meaning: string;
      unit: string;
      rules: string;
      evidence: string;
    }[];
    relations: {
      id: string;
      name: string;
      targetId: string;
      target: string;
      keys: { local: string; foreign: string }[];
      evidence: string;
    }[];
  };
  findings: Finding[];
  events: { event: string; at: string }[];
  batches: {
    at: string;
    version: number;
    actor: string;
    operation: string;
    status: string;
    reason: string;
  }[];
};
export const ACTIONS: Record<string, string> = {
  allow: '确认可以提供',
  retry: '重试解析',
  dictionary: '重新生成口径',
  recheck: '重新校验',
  remediate: '规则治理',
  analyze: 'AI 研判',
  sync: '立即取数',
  handle: '记录处理措施',
};
export async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const r = await fetch('/mengine-api' + path, {
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
    ...(body !== undefined
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  const data = await r.json().catch(() => ({ message: '数据服务暂不可用' }));
  if (!r.ok) throw Object.assign(Error(data.message || '请求失败'), { status: r.status });
  return data as T;
}
export function useFoundation() {
  const [data, setData] = useState<Snapshot | null>(null),
    [error, setError] = useState(''),
    [unauthorized, setUnauthorized] = useState(false),
    [loading, setLoading] = useState(true);
  const ticket = useRef(0),
    mounted = useRef(true);
  const refresh = useCallback(async () => {
    const seq = ++ticket.current;
    try {
      const value = await api<Snapshot>('/scene-foundation');
      if (mounted.current && seq === ticket.current) {
        setData(value);
        setError('');
        setUnauthorized(false);
      }
    } catch (e) {
      if (mounted.current && seq === ticket.current) {
        setData(null);
        setError((e as Error).message);
        setUnauthorized((e as { status?: number }).status === 401);
      }
    } finally {
      if (mounted.current && seq === ticket.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const t = setInterval(() => void refresh(), 15000);
    return () => {
      mounted.current = false;
      ticket.current++;
      clearInterval(t);
    };
  }, [refresh]);
  return { data, error, unauthorized, loading, refresh };
}
export type Foundation = ReturnType<typeof useFoundation>;
export function asItem(a: Asset): Item {
  return {
    id: a.id,
    name: a.title,
    group: a.department,
    why: a.label,
    side: a.kind === 'table' ? `${a.total} 条` : '资料',
    tone: a.tone,
    verdict: a.label,
    kvHead: ['字段', '含义', '依据'],
    kv: [],
    actions: a.actions,
  };
}
export const date = (v: string | null | undefined) =>
  v && Number.isFinite(Date.parse(v))
    ? new Date(v).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
    : '—';

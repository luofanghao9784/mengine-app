import { supportPath, supportRoute } from '../../identity/support-request';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Tone, Item } from './data';
import { sceneTenant } from './scene-route';
export type Asset = {
  nativeGovernance?: { state: string; message: string; canRun: boolean; jobId?: string; revision?: number; errorCode?: string };
  id: string;
  title: string;
  department: string;
  kind: 'table' | 'document';
  sourceKind: number;
  source: string;
  status: string;
  label: string;
  gate: number;
  stageStates?: string[];
  available: boolean;
  availabilityKind?: "PUBLISHED_KNOWLEDGE" | "PUBLISHED_GOVERNANCE";
  availableKnowledgeCount?: number;
  availabilityScope?: string;
  unknownFieldCount?: number;
  unknownFields?: string[];
  limitations?: string[];
  publishedAt?: string;
  needsAttention: boolean;
  checksPassed: boolean;
  paused: boolean;
  version: number;
  policyVersion: number;
  updatedAt: string;
  sourceCollectedAt?: string;
  sourceVerifiedAt?: string;
  receivedAt?: string;
  coverageThrough?: string;
  reviewAt: string;
  quality: number | null;
  classification: number;
  issues: string[];
  tags: string[];
  total: number | null;
  queryableRecords?: number;
  automaticAnalysisReady?: boolean;
  businessMetrics?: { name: string; state: 'SUPPORTED' | 'UNAVAILABLE'; reason: string }[];
  ruleStats?: { total: number; passed: number; violations: number; scope: string };
  ready: number | null;
  isolated: number | null;
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
  auditValid: boolean | null;
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
  const tenant = sceneTenant() ?? supportRoute()?.tenant;
  const headers: Record<string,string> = {};
  if (tenant && body !== undefined) {
    const csrf = await fetch(supportRoute() ? '/api/platform-admin/v1/auth/csrf' : '/api/v1/auth/csrf', { credentials:'same-origin', signal });
    if (!csrf.ok) throw Object.assign(Error('请重新登录企业管理端'), {status:csrf.status});
    const token = await csrf.json(); headers[token.headerName] = token.token;
  }
  const url = tenant ? `/api/tenant-admin/v1/tenants/${encodeURIComponent(tenant)}/scene/dispatch?path=${encodeURIComponent(path)}` : '/mengine-api' + path;
  const r = await fetch(supportPath(url), {
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
    ...(body !== undefined
      ? { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  const data = await r.json().catch(() => ({ message: '数据服务暂不可用' }));
  if (!r.ok) {
    const messages: Record<string, string> = {
      SCENE_NOT_CONFIGURED: '数据服务尚未配置，请由部署人员接通服务；成员加入与空间授权仍可在“账号、空间与职责交接”中办理。',
      SCENE_TENANT_NOT_BOUND: '该企业尚未绑定数据来源，请由部署人员核对企业及人员映射。',
      SCENE_UPSTREAM_UNAVAILABLE: '数据服务连接失败，请由部署人员检查本地服务运行状态。',
      SCENE_UPSTREAM_FAILED: '数据服务请求失败，请稍后重试；持续失败请联系部署人员。',
      SCENE_OPERATION_FORBIDDEN: '当前账号没有此操作权限，请核对数据授权；企业管理身份不自动授予内容访问权。',
      SCENE_READ_ONLY: '企业内容只读，此操作已停用。',
    };
    const message = messages[data.code] || data.message || (data.code === 'SCENE_REVISION_CONFLICT' ? '资源、权限或处理状态已变化，请刷新后重新提交。' : '请求失败');
    throw Object.assign(Error(message), { status: r.status, code: data.code });
  }
  return data as T;
}
export function useFoundation() {
  const [data, setData] = useState<Snapshot | null>(null),
    [error, setError] = useState(''),
    [unauthorized, setUnauthorized] = useState(false),
    [loading, setLoading] = useState(true);
  const ticket = useRef(0),
    mounted = useRef(true),
    last = useRef('');
  const refresh = useCallback(async () => {
    const seq = ++ticket.current;
    try {
      const value = await api<Snapshot>('/scene-foundation');
      if (mounted.current && seq === ticket.current) {
        // 内容没变就沿用旧对象：不重建 3D 世界，也不让清单和详情重算。
        const text = JSON.stringify({ ...value, at: '' });
        if (text !== last.current) {
          last.current = text;
          setData(value);
        }
        setError('');
        setUnauthorized(false);
      }
    } catch (e) {
      if (mounted.current && seq === ticket.current) {
        const status = (e as { status?: number }).status;
        // 网络抖动保留快照；登录、权限或资源失效时立即清空。
        if ([401, 403, 404, 410].includes(status ?? 0)) {
          last.current = '';
          setData(null);
        }
        setError((e as Error).message);
        setUnauthorized(status === 401);
      }
    } finally {
      if (mounted.current && seq === ticket.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const t = setInterval(() => {
      if (document.visibilityState !== 'hidden') void refresh();
    }, 15000);
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      mounted.current = false;
      ticket.current++;
      clearInterval(t);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [refresh]);
  return useMemo(
    () => ({ data, error, unauthorized, loading, refresh }),
    [data, error, unauthorized, loading, refresh],
  );
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

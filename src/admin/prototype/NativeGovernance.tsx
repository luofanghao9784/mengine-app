import { useEffect, useRef, useState } from 'react';
import type { Asset } from './foundation-api';

type Draft = { revision: number; sourceCurrent: boolean; request: { inputHash: string }; output: {
  summary: string; limitations: string[]; fields: { column: string; decision: string; meaning: string; unit: string; evidence: string }[];
} };
const errors: Record<string, string> = {
  GOVERNANCE_BACKGROUND_REQUIRED: '请先在企业信息登记企业背景，再开始治理。',
  GOVERNANCE_DISPATCH_DISABLED: '治理执行尚未开启，请联系部署维护者。',
  GOVERNANCE_SOURCE_CHANGED: '来源或背景已变化，请重新生成草稿。',
  GOVERNANCE_JOB_BUSY: '已有治理任务正在处理，请等待结果。',
  GOVERNANCE_STATE_CHANGED: '任务状态已变化，请刷新后继续。',
  GOVERNANCE_DRAFT_NOT_READY: '草稿尚未通过检查，不能发布。',
};
async function request<T>(tenant: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    const r = await fetch('/api/v1/auth/csrf', { credentials: 'same-origin', signal });
    if (!r.ok) throw Error('登录已失效，请重新登录。');
    const c = await r.json(); headers[c.headerName] = c.token; headers['Content-Type'] = 'application/json';
  }
  const r = await fetch(`/api/v1/tenants/${encodeURIComponent(tenant)}/governance-jobs${path}`, {
    credentials: 'same-origin', cache: 'no-store', signal,
    ...(body === undefined ? {} : { method: 'POST', headers, body: JSON.stringify(body) }),
  });
  const data = await r.json();
  if (!r.ok) throw Error(errors[data.code] || (r.status === 403 || r.status === 404 ? '当前无权处理该数据。' : '治理请求未完成，请刷新状态后重试。'));
  return data;
}

export function NativeGovernance({ asset, tenant, refresh, maintainBackground }: {
  asset: Asset; tenant: string; refresh(): Promise<void>; maintainBackground?: () => void;
}) {
  const status = asset.nativeGovernance!;
  const [draft, setDraft] = useState<Draft | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const latest = useRef(refresh); latest.current = refresh;
  const lock = useRef(false), requestId = useRef<string | null>(null);
  useEffect(() => {
    setDraft(null); setError('');
    if (status.state !== 'DRAFT_READY' || !status.jobId) return;
    const abort = new AbortController();
    request<Draft>(tenant, '/' + status.jobId, undefined, abort.signal).then(setDraft).catch(e => {
      if (!abort.signal.aborted) setError((e as Error).message);
    });
    return () => abort.abort();
  }, [tenant, status.state, status.jobId, status.revision]);
  useEffect(() => {
    if (!['WAITING_MODEL', 'VALIDATING'].includes(status.state)) return;
    const timer = setInterval(() => { void latest.current(); }, 5000);
    return () => clearInterval(timer);
  }, [status.state]);
  async function act(action: 'start' | 'retry' | 'publish') {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      if (action === 'publish' && draft && status.jobId) {
        await request(tenant, `/${status.jobId}/publish`, { revision: draft.revision, inputHash: draft.request.inputHash });
      } else if (action === 'retry' && status.jobId) {
        await request(tenant, `/${status.jobId}/retry`, { revision: status.revision });
      } else {
        requestId.current ??= crypto.randomUUID();
        await request(tenant, '/execute', { requestId: requestId.current, kind: 'DATASET', sourceId: asset.id.slice('dataset-'.length), executor: 'SYSTEM_MODEL' });
        requestId.current = null;
      }
      await latest.current();
    } catch (e) { setError((e as Error).message); await latest.current(); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="native-governance" aria-label="本表治理处理">
    <p role="status">{status.message}</p>
    {status.state === 'BACKGROUND_REQUIRED' && maintainBackground && <button className="gold" onClick={maintainBackground}>完善企业背景</button>}
    {status.canRun && ['NOT_STARTED', 'STALE'].includes(status.state) && <button className="gold" disabled={busy} onClick={() => void act('start')}>{busy ? '正在提交…' : '生成治理草稿'}</button>}
    {status.canRun && status.state === 'FAILED' && <button className="gold" disabled={busy} onClick={() => void act('retry')}>{busy ? '正在提交…' : '重试治理'}</button>}
    {status.state === 'FAILED' && status.errorCode && <p>错误编号：{status.errorCode}</p>}
    {draft && status.state === 'DRAFT_READY' && <>
      <h3>待发布的治理草稿</h3><p>{draft.output.summary}</p>
      {draft.output.limitations?.map((x, i) => <p key={i}>{x}</p>)}
      <details><summary>核对 {draft.output.fields.length} 个字段及依据</summary>
        {draft.output.fields.map(f => <section key={f.column}><h4>{f.column} · {f.decision === 'UNKNOWN' ? '待核实' : '有来源依据'}</h4>
          <p>{f.meaning}{f.unit ? ` · 单位：${f.unit}` : ''}</p><p>{f.evidence}</p></section>)}
      </details>
      <p>发布将使这份口径在原有数据权限内生效；未知项仍保留，不能据此认定账目或资金正确。</p>
      <button className="gold" disabled={busy || !draft.sourceCurrent} onClick={() => void act('publish')}>{busy ? '正在发布…' : '核对后发布治理结果'}</button>
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

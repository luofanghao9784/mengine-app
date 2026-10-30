import { useEffect, useState } from 'react';
import { createIdentityRequest, record, IdentityError } from '../identity/client';
import { useSession } from '../identity/session';
import { Failure, Loading } from '../shared/admin';
import './engine-attention.css';
import { businessReadinessReasons } from '../briefing-live/generation-reasons';

type Source = {
  kind: string;
  id: string;
  name: string;
  version: string;
  relationship: string;
  current: boolean;
};
type Item = {
  id: string;
  tenantId: string | null;
  tenantName: string;
  channel: string;
  state: string;
  title: string;
  code: string;
  note: string;
  at: string;
  sources: Source[];
};
type Page = {
  items: Item[];
  total: number;
  offset: number;
  hasMore: boolean;
  tenants: { id: string; name: string }[];
};
const request = createIdentityRequest();
const states: Record<string, string> = {
  RUNNING: '处理中',
  SUCCEEDED: '已完成',
  NO_NEW_CONTENT: '暂无新内容',
  QUALIFIED: '等待入库核验',
  RECHECKED: '已重新检查',
  QUEUED: '排队等待',
  WAITING_DATA: '等待数据',
  WAITING_RESOURCE: '等待资源 / 额度',
  FAILED: '失败',
  INTERRUPTED: '中断',
  UNKNOWN: '待核对',
  RESULT_UNKNOWN: '待核对',
  PARTIAL: '部分完成',
  PAUSED: '已暂停',
  WAITING_INPUT: '等待输入',
  WAITING_CAPABILITY: '等待能力 / 重试',
};
const reasons: Record<string, string> = {
  ...businessReadinessReasons,
  TENANT_DAILY_LIMIT: '企业当日执行额度已用完，等待额度恢复；重试不会绕过额度限制。',
  TENANT_CONCURRENCY_LIMIT: '企业当前执行名额已占满，等待运行中的任务结束。',
  OWNER_CONCURRENCY_LIMIT: '该用户当前执行名额已占满，等待运行中的任务结束。',
  MODEL_NOT_CONFIGURED: '模型服务尚未配置或未启用，请先恢复模型服务。',
  NO_MATERIALS: '没有当前可读取的数据，请先接入数据并确认权限。',
  TASK_LIMIT: '达到单次任务执行限制，未完成交付。',
  TASK_RESULT_UNKNOWN: '尚未确认最终执行结果，需要核对执行回执；不能视为成功或直接认定数据错误。',
  INPUT_REQUIRED: '任务需要补充输入或明确资料范围。',
  CAPABILITY_UNAVAILABLE: '当前任务需要的能力尚不可用。',
  PARSE_FAILED: '本次资料解析失败。',
  PARTIAL_PARSE: '本次资料仅部分解析。',
  UNSUPPORTED_FORMAT: '当前解析器不支持该格式。',
  SCENE_PROCESSING_FAILED: '业务知识生成失败；此历史事件没有记录具体来源，不能据此认定某张表失败。',
};
function isPage(v: unknown): v is Page {
  return (
    record(v) &&
    Number.isSafeInteger(v.total) &&
    Number(v.total) >= 0 &&
    Number.isSafeInteger(v.offset) &&
    typeof v.hasMore === 'boolean' &&
    Array.isArray(v.tenants) &&
    v.tenants.every((t) => record(t) && typeof t.id === 'string' && typeof t.name === 'string') &&
    Array.isArray(v.items) &&
    v.items.every(
      (i) =>
        record(i) &&
        ['id', 'tenantName', 'channel', 'state', 'title', 'code', 'note', 'at'].every(
          (k) => typeof i[k] === 'string',
        ) &&
        (i.tenantId === null || typeof i.tenantId === 'string') &&
        Array.isArray(i.sources) &&
        i.sources.every(
          (s) =>
            record(s) &&
            ['kind', 'id', 'name', 'version', 'relationship'].every((k) => typeof s[k] === 'string') &&
            typeof s.current === 'boolean',
        ),
    )
  );
}
export function EngineAttention() {
  const [open, setOpen] = useState(false);
  return (
    <details className="engine-attention-detail" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>查看异常与待核对数据</summary>
      {open && <AttentionList />}
    </details>
  );
}
function AttentionList() {
  const { expire } = useSession();
  const [tenant, setTenant] = useState(''),
    [state, setState] = useState('ALL'),
    [offset, setOffset] = useState(0),
    [refresh, setRefresh] = useState(0);
  const [value, setValue] = useState<Page>(),
    [error, setError] = useState<unknown>();
  const [tenants, setTenants] = useState<Page['tenants']>([]);
  useEffect(() => {
    const abort = new AbortController();
    let disposed = false;
    setValue(undefined);
    setError(undefined);
    const query = new URLSearchParams({ state, offset: String(offset) });
    if (tenant) query.set('tenant', tenant);
    request(
      '/api/platform-admin/v1/engine-telemetry/attention?' + query,
      'GET',
      isPage,
      undefined,
      abort.signal,
    )
      .then((v) => {
        if (!disposed) {
          setValue(v);
          setTenants(v.tenants);
        }
      })
      .catch((e) => {
        if (!disposed) {
          setError(e);
          if (e instanceof IdentityError && e.status === 401) expire();
        }
      });
    return () => {
      disposed = true;
      abort.abort();
    };
  }, [tenant, state, offset, refresh, expire]);
  return (
    <div>
      <p className="muted">
        保留历史异常，不自动清除。以下为任务关联来源，不代表每份数据都有错误；同一份数据可关联多个任务。
      </p>
      <div className="engine-attention-filters">
        <label>
          企业{' '}
          <select
            aria-label="异常所属企业"
            value={tenant}
            onChange={(e) => {
              setTenant(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">全部企业</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          状态{' '}
          <select
            aria-label="异常状态"
            value={state}
            onChange={(e) => {
              setState(e.target.value);
              setOffset(0);
            }}
          >
            <option value="ALL">全部需留意</option>
            <option value="FAILED">失败 / 中断</option>
            <option value="UNKNOWN">待核对</option>
            <option value="WAITING">等待 / 部分完成</option>
          </select>
        </label>
        <button className="button ghost" onClick={() => setRefresh((v) => v + 1)}>
          刷新明细
        </button>
      </div>
      {tenant ? (
        <details key={`${tenant}:${refresh}`}>
          <summary>该企业的数据治理待核对项</summary>
          <Governance tenant={tenant} />
        </details>
      ) : (
        <p className="muted">选择具体企业，可查看其数据治理问题与涉及数量。</p>
      )}
      {error ? (
        <Failure error={error} retry={() => setRefresh((v) => v + 1)} />
      ) : !value ? (
        <Loading />
      ) : (
        <>
          <p>
            共 {value.total} 条记录
            {value.total > 0 && ` · 当前 ${offset + 1}—${offset + value.items.length} 条`}
          </p>
          {value.items.length === 0 ? (
            <p>此筛选范围没有异常或待核对记录。</p>
          ) : (
            value.items.map((item) => (
              <article className="engine-attention-item" key={`${item.channel}:${item.id}`}>
                <header>
                  <strong>
                    {item.title} · {states[item.state] ?? item.state}
                  </strong>
                  <span>
                    {item.tenantName} · {new Date(item.at).toLocaleString('zh-CN', { hour12: false })}
                  </span>
                </header>
                <p>
                  {reasons[item.code] ??
                    (item.state === 'PARTIAL'
                      ? '仅完成部分工作，请结合任务说明核对未完成项。'
                      : '本次执行尚未完整完成，需核对处理记录。')}
                  {item.code && <small>（{item.code}）</small>}
                </p>
                {item.note && (
                  <details>
                    <summary>任务说明（模型记录，需核实）</summary>
                    <p className="engine-attention-note">{item.note}</p>
                  </details>
                )}
                <details>
                  <summary>
                    涉及数据：
                    {item.sources.length ? `${item.sources.length} 条来源版本记录` : '未记录可追溯来源'}
                  </summary>
                  {item.sources.length ? (
                    <ul>
                      {item.sources.map((s, i) => (
                        <li key={`${s.id}:${s.version}:${i}`}>
                          <strong>{s.name}</strong>
                          <br />
                          <span>
                            {s.version} · {s.relationship} · {s.current ? '当前版本' : '历史版本或已撤下'}
                          </span>
                          <br />
                          <small>对象编号：{s.id}</small>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>该记录没有保存可追溯的数据表或资料版本。不能推测具体哪份数据出错。</p>
                  )}
                </details>
                <small>任务 / 运行编号：{item.id}</small>
                <RetryAction item={item} />
              </article>
            ))
          )}
          <div className="engine-attention-filters">
            <button
              className="button ghost"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 20))}
            >
              上一页
            </button>
            <button className="button ghost" disabled={!value.hasMore} onClick={() => setOffset(offset + 20)}>
              下一页
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const retryErrors: Record<string, string> = {
  ENGINE_RETRY_STATE_CHANGED: '状态已变化，可能已经执行或正在处理。请刷新明细后查看。',
  ENGINE_RETRY_ALREADY_PROCESSED: '该来源已有后续处理，或原异常已被后续成功执行覆盖，无需重复调用模型。',
  ENGINE_RETRY_SOURCE_UNAVAILABLE: '来源已撤回、失效或权限发生变化。请先恢复有效数据与授权。',
  ENGINE_RETRY_TENANT_INACTIVE: '企业服务未启用，请先恢复企业服务。',
  TASK_RECONCILIATION_REQUIRED:
    '尚不能确认旧任务是否已产生结果，暂未重新执行。需先核对执行回执，防止重复产出。',
  TASK_INPUT_REQUIRED: '请填写补充说明后重试。',
  TASK_RUNTIME_UNAVAILABLE: '引擎尚未启用，请先恢复引擎配置。',
  CONNECTION_UNAVAILABLE: '数据连接不可用，请先恢复连接或重新上传原文件。',
  TASK_PLAN_INACTIVE: '任务执行计划不可用，请先恢复计划。',
  CONVERSATION_BUSY: '同一会话已有任务正在处理，请完成后再试。',
  KNOWLEDGE_GENERATION_CONFLICT: '资料已有新的解析任务，请刷新查看。',
};
function RetryAction({ item }: { item: Item }) {
  const { expire } = useSession();
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [input, setInput] = useState('');
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [submitted, setSubmitted] = useState(false);
  const run = async () => {
    if (busy || submitted) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await request(
        '/api/platform-admin/v1/engine-telemetry/attention/retry',
        'POST',
        (v: unknown): v is { id: string; state: string; message: string } =>
          record(v) &&
          typeof v.id === 'string' &&
          typeof v.state === 'string' &&
          typeof v.message === 'string',
        {
          requestId,
          tenantId: item.tenantId,
          channel: item.channel,
          id: item.id,
          expectedState: item.state,
          input: input || null,
        },
      );
      setSubmitted(true);
      setMessage(
        (states[result.state] ?? result.state) +
          '：' +
          result.message.replace(/[A-Z][A-Z0-9_]+/g, (code) => reasons[code] ?? code) +
          ' 请刷新明细查看后续状态。',
      );
    } catch (e) {
      if (e instanceof IdentityError && e.status === 401) expire();
      setMessage(
        e instanceof IdentityError
          ? (retryErrors[e.code] ?? '暂未提交，请先检查处理条件。错误码：' + e.code)
          : '请求结果尚未确认，可再次点击核对；不会因重复提交创建重复任务。',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="engine-retry-action">
      {(item.channel === 'TASK' || item.channel === 'RETRIEVAL') && (
        <details>
          <summary>补充重试说明（需要输入时填写）</summary>
          <textarea
            aria-label="重试补充说明"
            maxLength={2000}
            value={input}
            disabled={busy || submitted}
            onChange={(e) => {
              setInput(e.target.value);
              setRequestId(crypto.randomUUID());
            }}
          />
        </details>
      )}
      <button className="button ghost" disabled={busy || submitted} onClick={() => void run()}>
        {busy
          ? '正在检查…'
          : submitted
            ? '已提交 / 已核对'
            : ['UNKNOWN', 'RESULT_UNKNOWN'].includes(item.state)
              ? '核对并重试'
              : ['QUEUED', 'WAITING_DATA', 'WAITING_RESOURCE', 'WAITING_CAPABILITY'].includes(item.state)
                ? '检查并重试'
                : '重试处理'}
      </button>
      {message && <p role="status">{message}</p>}
    </div>
  );
}

type Asset = { id: string; title: string; version: number; label: string; needsAttention: boolean };
type GovernanceDetail = {
  findings: Finding[];
  asset?: { version: number; policyVersion: number; actions: string[] };
};
type Finding = { id: string; title: string; detail: string; count: number; status: string };
function Governance({ tenant }: { tenant: string }) {
  const [assets, setAssets] = useState<Asset[]>(),
    [error, setError] = useState<unknown>();
  useEffect(() => {
    const c = new AbortController();
    let disposed = false;
    request(
      `/api/platform-admin/v1/tenants/${tenant}/scene/dispatch?path=%2Fscene-foundation`,
      'GET',
      (v: unknown): v is { items: Asset[] } =>
        record(v) &&
        Array.isArray(v.items) &&
        v.items.every(
          (a) =>
            record(a) &&
            typeof a.id === 'string' &&
            typeof a.title === 'string' &&
            typeof a.version === 'number' &&
            typeof a.needsAttention === 'boolean' &&
            typeof a.label === 'string',
        ),
      undefined,
      c.signal,
    )
      .then((v) => {
        if (!disposed) setAssets(v.items.filter((a) => a.needsAttention));
      })
      .catch((e) => {
        if (!disposed) setError(e);
      });
    return () => {
      disposed = true;
      c.abort();
    };
  }, [tenant]);
  return (
    <div>
      <p>
        治理提示按数据表或资料列出。一对多关联、未发生对应业务等情况需要结合业务核对，不能直接视为脏数据。
      </p>
      {error ? (
        <p role="alert">暂时无法读取该企业的数据治理记录，请确认数据底座已接入并稍后刷新。</p>
      ) : !assets ? (
        <Loading />
      ) : assets.length === 0 ? (
        <p>当前没有待核对的治理提示。</p>
      ) : (
        assets.map((a) => <GovernanceAsset key={a.id} tenant={tenant} asset={a} />)
      )}
    </div>
  );
}
function GovernanceAsset({ tenant, asset }: { tenant: string; asset: Asset }) {
  const [open, setOpen] = useState(false),
    [findings, setFindings] = useState<Finding[]>(),
    [error, setError] = useState(false),
    [detail, setDetail] = useState<GovernanceDetail>(),
    [refresh, setRefresh] = useState(0),
    [retrying, setRetrying] = useState(false),
    [retryMessage, setRetryMessage] = useState('');
  useEffect(() => {
    if (!open) return;
    let disposed = false;
    const c = new AbortController();
    request(
      `/api/platform-admin/v1/tenants/${tenant}/scene/dispatch?path=${encodeURIComponent('/scene-foundation/' + asset.id)}`,
      'GET',
      (v: unknown): v is GovernanceDetail =>
        record(v) &&
        Array.isArray(v.findings) &&
        v.findings.every(
          (f) =>
            record(f) &&
            ['id', 'title', 'detail', 'status'].every((k) => typeof f[k] === 'string') &&
            typeof f.count === 'number',
        ),
      undefined,
      c.signal,
    )
      .then((v) => {
        if (!disposed) {
          setFindings(v.findings);
          setDetail(v);
          setError(false);
        }
      })
      .catch(() => {
        if (!disposed) setError(true);
      });
    return () => {
      disposed = true;
      c.abort();
    };
  }, [open, tenant, asset.id, refresh]);
  const recheck = async () => {
    if (retrying) return;
    setRetrying(true);
    setRetryMessage('');
    try {
      const a = detail?.asset;
      if (!a || !Array.isArray(a.actions)) throw new Error('metadata');
      const action = a.actions.includes('recheck') ? 'recheck' : a.actions.includes('retry') ? 'retry' : null;
      if (!action) throw new Error('unavailable');
      await request(
        `/api/platform-admin/v1/tenants/${tenant}/scene/dispatch?path=${encodeURIComponent('/scene-foundation/' + asset.id + '/actions')}`,
        'POST',
        (v: unknown): v is Record<string, unknown> => record(v),
        {
          action,
          version: a.version,
          policyVersion: a.policyVersion,
          reason: '总台人工发起重新检查，保留原问题与核验依据',
        },
      );
      setRetryMessage('已重新检查。未满足治理规则的内容仍保留为待核对，不会自动批准。');
      setRefresh((v) => v + 1);
    } catch (e) {
      setRetryMessage(
        e instanceof IdentityError ? e.message : '当前不允许重新检查，请先恢复有效来源与治理权限。',
      );
    } finally {
      setRetrying(false);
    }
  };
  return (
    <details className="engine-attention-item" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        {asset.title} · V{asset.version} · {asset.label}
      </summary>
      <small>数据底座对象：{asset.id}</small>
      {asset.id.startsWith('file-') ? (
        <RetryAction
          item={{
            id: asset.id.slice(5),
            tenantId: tenant,
            tenantName: '',
            channel: 'FILE_TABLE',
            state: 'V' + asset.version,
            title: asset.title,
            code: '',
            note: '',
            at: '',
            sources: [],
          }}
        />
      ) : (
        <div>
          <button className="button ghost" disabled={retrying || !detail} onClick={() => void recheck()}>
            {retrying ? '正在重新检查…' : '重新检查 / 重试'}
          </button>
          {retryMessage && <p role="status">{retryMessage}</p>}
        </div>
      )}
      {error ? (
        <p role="alert">读取失败，请收起后重新展开。</p>
      ) : !findings ? (
        <Loading />
      ) : findings.length === 0 ? (
        <p>没有细项记录，请以该对象的状态提示为准。</p>
      ) : (
        <ul>
          {findings.map((f) => (
            <li key={f.id}>
              <strong>
                {f.title} · 涉及 {f.count} 条 ·{' '}
                {f.status === 'open' ? '待核对' : f.status === 'resolved' ? '已解决' : f.status}
              </strong>
              <p>{f.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

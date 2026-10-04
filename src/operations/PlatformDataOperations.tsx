import { useState } from 'react';
import { ArrowLeft, RefreshCw, Search } from 'lucide-react';
import type {
  DataOperationCounts,
  DataOperationKind,
  DataOperationState,
  DataOperationDiagnostic,
} from '../../contracts/public-api/data-operations';
import { adminHref } from '../admin/navigation';
import { uuid } from '../identity/client';
import { useViewState, textState, pageState } from '../shared/useViewState';
import { Button, Badge, PageActions } from '../shared/ui';
import { Failure, Loading, Pager, useRemote } from '../shared/admin';
import { dataOperationsClient as api } from './data-client';
import './data-operations.css';
const states: Record<DataOperationState, string> = {
  ALL: '全部状态',
  READY: '已完成',
  PROCESSING: '处理中',
  ATTENTION: '需留意',
  NOT_STARTED: '尚未开始',
  STOPPED: '已停止',
};
const stages: Record<string, string> = {
  NOT_STARTED: '尚无处理记录',
  QUEUED: '排队中',
  RUNNING: '执行中',
  SUCCEEDED: '取数完成',
  READY: '解析完成',
  FAILED: '处理失败',
  INTERRUPTED: '执行中断',
  PARTIAL: '部分解析',
  UNSUPPORTED: '暂不支持',
  CANCELLED: '已取消',
};
const diagnostics: Record<DataOperationDiagnostic, string> = {
  CONNECTION_UNAVAILABLE: '接入当前不可用，需核对现场部署状态。',
  CONNECTION_UNCONFIGURED: '尚未完成接入部署。',
  COLLECTION_TIMEOUT: '取数超过执行时间限制。',
  COLLECTION_INVALID_RESULT: '取数结果不符合约定格式。',
  COLLECTION_ADAPTER_FAILED: '现场采集适配器执行未完成。',
  COLLECTION_INTERRUPTED: '取数执行中断。',
  OTHER: '处理未完成，详细技术原因尚未确认。',
  PARSE_FAILED: '解析未完成，需在原处理系统核对。',
  UNSUPPORTED_FORMAT: '当前解析器暂不支持此格式。',
  PARTIAL_PARSE: '本次仅完成部分解析。',
};
const chosen = (v: unknown): v is DataOperationState => typeof v === 'string' && Object.hasOwn(states, v);
const time = (v: string | null) => (v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '暂无记录');
const n = (v: number) => v.toLocaleString('zh-CN');
const kindName = (k: DataOperationKind) => (k === 'CONNECTIONS' ? '数据接入' : '资料处理');
function Metrics({ value }: { value: DataOperationCounts }) {
  return (
    <dl className="data-ops-metrics">
      {[
        ['监测对象', value.total],
        ['已完成', value.ready],
        ['处理中', value.processing],
        ['需留意', value.attention],
        ['尚未开始', value.notStarted],
        ['已停止', value.stopped],
      ].map(([label, count]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{n(Number(count))}</dd>
        </div>
      ))}
    </dl>
  );
}
function Filter({ value, change }: { value: DataOperationState; change: (v: DataOperationState) => void }) {
  return (
    <select
      aria-label="运行状态"
      value={value}
      onChange={(e) => change(e.target.value as DataOperationState)}
    >
      {Object.entries(states).map(([id, label]) => (
        <option key={id} value={id}>
          {label}
        </option>
      ))}
    </select>
  );
}
export function PlatformDataOperations({ hash }: { hash: string }) {
  const p = new URLSearchParams(hash.slice(1));
  const kind: DataOperationKind = p.get('kind') === 'MATERIALS' ? 'MATERIALS' : 'CONNECTIONS';
  const supplied = p.get('enterprise');
  const tenant = uuid(supplied) ? supplied : null;
  const href = (k: DataOperationKind, enterprise?: string) =>
    adminHref('platform', 'engine', hash, { detail: 'data', kind: k, ...(enterprise ? { enterprise } : {}) });
  return (
    <div className="data-ops-page">
      <a className="button ghost" href={tenant ? href(kind) : adminHref('platform', 'engine', hash)}>
        <ArrowLeft size={16} />
        {tenant ? '返回企业列表' : '返回系统运行'}
      </a>
      <nav className="data-ops-nav" aria-label="数据运行分类">
        {(['CONNECTIONS', 'MATERIALS'] as const).map((k) => (
          <a
            key={k}
            className={k === kind ? 'active' : ''}
            href={href(k, tenant || undefined)}
            aria-current={k === kind ? 'page' : undefined}
          >
            {kindName(k)}
          </a>
        ))}
      </nav>
      {tenant ? (
        <Detail key={`${kind}:${tenant}`} tenant={tenant} kind={kind} />
      ) : (
        <Directory key={kind} kind={kind} href={(id) => href(kind, id)} />
      )}
    </div>
  );
}
function Directory({ kind, href }: { kind: DataOperationKind; href: (id: string) => string }) {
  const [query, setQuery] = useViewState('platform', `data-ops:${kind}:query`, '', textState);
  const [draft, setDraft] = useState(query);
  const [state, setState] = useViewState<DataOperationState>(
    'platform',
    `data-ops:${kind}:state`,
    'ALL',
    chosen,
  );
  const [page, setPage] = useViewState('platform', `data-ops:${kind}:page`, 0, pageState);
  const [attempt, setAttempt] = useState(0);
  const refresh = () => setAttempt((v) => v + 1);
  const data = useRemote(
    (signal) => api.list(kind, query, state, page * 20, signal),
    [kind, query, state, page, attempt],
  );
  return (
    <section className="admin-section" aria-label="数据运行企业列表">
      <div className="data-ops-heading">
        <div>
          <h2>{kindName(kind)}</h2>
          <p className="admin-note">按企业查看运行情况，不开放原始资料或业务数据。</p>
        </div>
        <Button variant="ghost" icon={RefreshCw} onClick={refresh}>
          刷新
        </Button>
      </div>
      <form
        className="data-ops-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(draft.trim());
          setPage(0);
        }}
      >
        <label>
          <Search size={18} />
          <input
            aria-label="搜索企业"
            placeholder="搜索企业"
            value={draft}
            maxLength={180}
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
        <Button type="submit">搜索</Button>
        <Filter
          value={state}
          change={(v) => {
            setState(v);
            setPage(0);
          }}
        />
      </form>
      {data.error ? (
        <Failure error={data.error} retry={refresh} />
      ) : !data.value ? (
        <Loading />
      ) : (
        <>
          <p className="admin-note">
            匹配 {n(data.value.matchedTenants)} 家企业 · 下方汇总为这些企业的全部{kindName(kind)}对象
          </p>
          <Metrics value={data.value.counts} />
          <div className="data-ops-tenants">
            {data.value.items.map((t) => (
              <a key={t.tenantId} href={href(t.tenantId)}>
                <div>
                  <h3>{t.tenantName}</h3>
                  <span className="admin-note">
                    {n(t.counts.total)} 项 · 处理中 {n(t.counts.processing)} · 需留意 {n(t.counts.attention)}
                  </span>
                </div>
                <div>
                  <Badge>
                    {t.tenantStatus === 'SUSPENDED'
                      ? '企业已暂停'
                      : t.counts.attention
                        ? '需留意'
                        : t.counts.processing
                          ? '处理中'
                          : t.counts.total === 0
                            ? '尚无对象'
                            : t.counts.notStarted
                              ? '尚未开始'
                              : t.counts.stopped
                                ? '有停止项'
                                : '已完成'}
                  </Badge>
                  <small>最近成功 {time(t.lastSuccessAt)}</small>
                </div>
              </a>
            ))}
          </div>
          {!data.value.items.length && <p className="admin-note">没有符合条件的企业。</p>}
          <Pager page={page} next={data.value.hasMore} onPage={setPage} />
          <p className="admin-note">更新于 {time(data.value.checkedAt)} · 手动刷新</p>
        </>
      )}
    </section>
  );
}
function Detail({ tenant, kind }: { tenant: string; kind: DataOperationKind }) {
  const [state, setState] = useViewState<DataOperationState>(
    'platform',
    `data-ops:${kind}:${tenant}:state`,
    'ALL',
    chosen,
  );
  const [page, setPage] = useViewState('platform', `data-ops:${kind}:${tenant}:page`, 0, pageState);
  const [attempt, setAttempt] = useState(0);
  const refresh = () => setAttempt((v) => v + 1);
  const data = useRemote(
    (signal) => api.detail(tenant, kind, state, page * 20, signal),
    [tenant, kind, state, page, attempt],
  );
  return (
    <section className="admin-section" aria-label="企业数据运行详情">
      <PageActions>
        <Filter
          value={state}
          change={(v) => {
            setState(v);
            setPage(0);
          }}
        />
        <Button variant="ghost" icon={RefreshCw} onClick={refresh}>
          刷新
        </Button>
      </PageActions>
      {data.error ? (
        <Failure error={data.error} retry={refresh} />
      ) : !data.value ? (
        <Loading />
      ) : (
        <>
          <div className="data-ops-heading">
            <h2>
              {data.value.tenantName} · {kindName(kind)}
            </h2>
            <Badge>{data.value.tenantStatus === 'SUSPENDED' ? '企业已暂停' : '服务中'}</Badge>
          </div>
          <p className="admin-note">
            {kind === 'CONNECTIONS'
              ? '每个现场接入显示最近一次运行，未成功时不代表历史数据被清除。'
              : '仅显示在库资料当前版本的最近解析；包含企业与个人范围的运行元信息。'}{' '}
            页面不提供原件、业务记录、原始日志或重新执行操作。
          </p>
          <Metrics value={data.value.counts} />
          <div className="data-ops-records">
            {data.value.items.map((i) => (
              <article key={i.monitorKey}>
                <div className="data-ops-heading">
                  <h3>
                    {kind === 'CONNECTIONS' ? '接入' : '解析'}监测 · {i.monitorKey.slice(0, 8)}
                  </h3>
                  <Badge>{states[i.category]}</Badge>
                </div>
                <dl>
                  <div>
                    <dt>当前阶段</dt>
                    <dd>{stages[i.stage]}</dd>
                  </div>
                  {i.configuration && (
                    <div>
                      <dt>部署状态</dt>
                      <dd>
                        {{ READY: '已部署', UNAVAILABLE: '不可用', UNCONFIGURED: '未部署' }[i.configuration]}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>执行编号</dt>
                    <dd>{i.runId || '尚未产生'}</dd>
                  </div>
                  <div>
                    <dt>登记时间</dt>
                    <dd>{time(i.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>本次结束</dt>
                    <dd>{time(i.finishedAt)}</dd>
                  </div>
                  <div>
                    <dt>最近成功</dt>
                    <dd>{time(i.lastSuccessAt)}</dd>
                  </div>
                </dl>
                {i.diagnostic && <p className="data-ops-diagnostic">{diagnostics[i.diagnostic]}</p>}
              </article>
            ))}
          </div>
          {!data.value.items.length && <p className="admin-note">当前筛选下没有监测对象。</p>}
          <Pager page={page} next={data.value.hasMore} onPage={setPage} />
          <p className="admin-note">更新于 {time(data.value.checkedAt)} · 处理完成不等于业务结果正确</p>
        </>
      )}
    </section>
  );
}

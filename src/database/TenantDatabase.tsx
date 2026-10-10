import { useContext, useEffect, useState } from 'react';
import { ArrowLeft, Database, Plug, RefreshCw, Search } from 'lucide-react';
import { Button, Badge, Empty, Field, Modal, PageActions } from '../shared/ui';
import { Failure, Loading, Pager, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { RequestPending, requestNavigationLocked, useRequestLock } from '../shared/request-guard';
import { useViewState, textState, pageState } from '../shared/useViewState';
import { adminHref } from '../admin/navigation';
import { uuid } from '../identity/client';
import {
  databaseClient as api,
  type CollectionRun,
  type CollectionSchedule,
  type DataConnection,
} from './client';
import './database.css';
import { DatasetLifecyclePanel } from './DatasetLifecyclePanel';
const date = (v: string | null) => (v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '尚无记录');
const frequency = (s: CollectionSchedule) =>
  s.frequency === 'DAILY'
    ? `每天 ${s.dailyTime}`
    : s.frequency === 'HOURLY'
      ? '每小时'
      : s.frequency === 'QUARTER_HOUR'
        ? '每 15 分钟'
        : '尚未设置';
const status = (s: DataConnection['status']) =>
  ({ READY: '接入可用', UNAVAILABLE: '连接不可用', UNCONFIGURED: '尚未部署' })[s];
const runStatus = (r: CollectionRun | null) =>
  r
    ? {
        QUEUED: '等待更新',
        RUNNING: '更新中',
        SUCCEEDED: '已完成',
        FAILED: '更新失败',
        INTERRUPTED: '已中断',
      }[r.status]
    : '暂无更新';
const reasons: Record<string, string> = {
  COLLECTION_TIMEOUT: '外部读取超时',
  COLLECTION_ADAPTER_FAILED: '采集执行失败，请联系部署维护人员核对',
  COLLECTION_INVALID_RESULT: '返回的数据未通过结构与范围校验',
  COLLECTION_LEASE_EXPIRED: '执行超时，未接受迟到结果',
  TENANT_EXITING: '企业正在退出，取数已停止',
  TENANT_SERVICE_SUSPENDED: '企业服务已暂停',
  AUTHORIZATION_REVOKED: '发起者的取数资格已失效',
  DEPLOYMENT_CHANGED: '部署范围已调整',
  CONNECTION_UNAVAILABLE: '连接当前不可用',
  DATASET_UNCONFIGURED: '尚未部署数据集',
};
const reason = (r: CollectionRun | null) =>
  r?.reason ? reasons[r.reason] || '更新未完成，请查看接入状态' : null;
function useProgressRefresh(active: boolean, refresh: () => void) {
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && !requestNavigationLocked()) refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [active, refresh]);
}
export function TenantDatabase({ tenant, hash }: { tenant: string; hash: string }) {
  const pending = useContext(RequestPending),
    params = new URLSearchParams(hash.slice(1));
  const section =
      params.get('section') === 'access'
        ? 'access'
        : params.get('section') === 'lifecycle'
          ? 'lifecycle'
          : 'data',
    connection = params.get('connection'),
    dataset = params.get('dataset');
  const href = (extra: Record<string, string>) => adminHref('tenant', 'database', hash, extra);
  return (
    <div className="admin-dashboard tenant-database-page">
      <nav className="platform-detail-nav" aria-label="数据库栏目">
        {(
          [
            ['data', '数据管理'],
            ['access', '数据接入'],
            ['lifecycle', '撤下与清理'],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            disabled={pending}
            variant="ghost"
            aria-current={section === key ? 'page' : undefined}
            onClick={() => {
              location.hash = href({ section: key });
            }}
          >
            {label}
          </Button>
        ))}
      </nav>
      {section === 'lifecycle' ? (
        <DatasetLifecyclePanel tenant={tenant} />
      ) : section === 'access' ? (
        uuid(connection) ? (
          <ConnectionDetail key={connection} tenant={tenant} id={connection} hash={hash} />
        ) : (
          <Connections tenant={tenant} hash={hash} />
        )
      ) : uuid(dataset) ? (
        <DatasetDetail key={dataset} tenant={tenant} id={dataset} hash={hash} />
      ) : (
        <DataList tenant={tenant} hash={hash} />
      )}
    </div>
  );
}
function DataList({ tenant, hash }: { tenant: string; hash: string }) {
  const [query, setQuery] = useViewState(tenant, 'database:query', '', textState),
    [draft, setDraft] = useState(query);
  const [state, setState] = useViewState(tenant, 'database:state', '', textState),
    [page, setPage] = useViewState(tenant, 'database:page', 0, pageState);
  const [attempt, setAttempt] = useState(0),
    refresh = () => setAttempt((n) => n + 1);
  const data = useRemote(
    async (signal) => {
      const [summary, list] = await Promise.all([
        api.summary(tenant, signal),
        api.datasets(tenant, query, state, page * 20, signal),
      ]);
      return { summary, list };
    },
    [tenant, query, state, page, attempt],
  );
  useProgressRefresh(!!data.value?.summary.updating, refresh);
  return (
    <>
      <PageActions>
        <Button variant="ghost" icon={RefreshCw} onClick={refresh}>
          刷新
        </Button>
      </PageActions>
      {data.value && (
        <div className="database-metrics">
          {(
            [
              ['数据集', data.value.summary.datasets],
              ['已有可用数据', data.value.summary.available],
              ['更新中', data.value.summary.updating],
              ['更新异常', data.value.summary.failed],
            ] as const
          ).map(([label, value]) => (
            <section className="admin-section" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
              <small>当前获权范围</small>
            </section>
          ))}
        </div>
      )}
      <section className="admin-section tenant-directory-card">
        <div className="platform-list-heading admin-directory-heading">
          <h2>数据集</h2>
          <form
            className="platform-filters"
            onSubmit={(e) => {
              e.preventDefault();
              setQuery(draft.trim());
              setPage(0);
            }}
          >
            <label className="platform-search">
              <Search size={18} />
              <input
                aria-label="搜索数据集"
                placeholder="搜索数据集"
                maxLength={160}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            </label>
            <Button type="submit">搜索</Button>
            <select
              aria-label="数据更新状态"
              value={state}
              onChange={(e) => {
                setState(e.target.value);
                setPage(0);
              }}
            >
              <option value="">全部状态</option>
              <option value="AVAILABLE">已有可用数据</option>
              <option value="UPDATING">更新中</option>
              <option value="FAILED">更新异常</option>
              <option value="EMPTY">暂无可用数据</option>
            </select>
          </form>
        </div>
        {data.error ? (
          <Failure error={data.error} retry={refresh} />
        ) : !data.value ? (
          <Loading />
        ) : !data.value.list.items.length ? (
          <Empty
            icon={Database}
            title="没有匹配的数据集"
            text="现场部署后，当前获权的数据集会显示在这里。管理接入不会自动获得数据内容权限。"
          />
        ) : (
          <>
            <div className="tenant-directory-scroll">
              <div className="tenant-list-columns tenant-dataset-grid">
                <span>数据集</span>
                <span>所属空间</span>
                <span>记录数</span>
                <span>更新状态</span>
                <span>最近成功</span>
              </div>
              <div className="admin-directory-list">
                {data.value.list.items.map((d) => (
                  <a
                    className="admin-directory-row tenant-dataset-grid"
                    key={d.id}
                    href={adminHref('tenant', 'database', hash, { section: 'data', dataset: d.id })}
                  >
                    <span>
                      <strong>{d.name}</strong>
                      <small>{d.version === null ? '暂无可用数据' : `版本 ${d.version}`}</small>
                    </span>
                    <span>{d.workspaceName}</span>
                    <span>{d.version === null ? '—' : d.rowCount?.toLocaleString('zh-CN')}</span>
                    <span>
                      <Badge>{runStatus(d.latestRun)}</Badge>
                    </span>
                    <time>{date(d.collectedAt)}</time>
                  </a>
                ))}
              </div>
            </div>
            <Pager page={page} next={data.value.list.hasMore} onPage={setPage} />
          </>
        )}
      </section>
    </>
  );
}
function DatasetDetail({ tenant, id, hash }: { tenant: string; id: string; hash: string }) {
  const [page, setPage] = useState(0),
    [attempt, setAttempt] = useState(0),
    refresh = () => setAttempt((n) => n + 1);
  const remote = useRemote(
    (signal) => api.preview(tenant, id, page * 20, signal),
    [tenant, id, page, attempt],
  );
  const data = remote.value?.dataset;
  useProgressRefresh(data?.latestRun?.status === 'RUNNING' || data?.latestRun?.status === 'QUEUED', refresh);
  return (
    <>
      <PageActions>
        <Button variant="ghost" icon={RefreshCw} onClick={refresh}>
          刷新
        </Button>
      </PageActions>
      <div>
        <a className="button ghost" href={adminHref('tenant', 'database', hash, { section: 'data' })}>
          <ArrowLeft size={16} />
          返回数据管理
        </a>
      </div>
      {remote.error ? (
        <Failure error={remote.error} retry={refresh} />
      ) : !remote.value || !data ? (
        <Loading />
      ) : (
        <section className="admin-section">
          <div className="admin-section-heading">
            <h2>{data.name}</h2>
            <Badge>{runStatus(data.latestRun)}</Badge>
          </div>
          <DatasetLifecyclePanel tenant={tenant} id={id} />
          <p className="admin-note">
            {data.workspaceName}
            {data.description && ` · ${data.description}`}
          </p>
          <dl className="database-facts">
            <div>
              <dt>数据可用性</dt>
              <dd>{data.version === null ? '暂无可用数据' : `可用 · 版本 ${data.version}`}</dd>
            </div>
            <div>
              <dt>最近成功</dt>
              <dd>{date(data.collectedAt)}</dd>
            </div>
            <div>
              <dt>数据覆盖至</dt>
              <dd>{data.coverageThrough ? date(data.coverageThrough) : '尚未提供覆盖时间'}</dd>
            </div>
            <div>
              <dt>记录数</dt>
              <dd>{data.rowCount ?? '尚未获取'}</dd>
            </div>
          </dl>
          {reason(data.latestRun) && (
            <p className="access-alert">
              {reason(data.latestRun)}。{data.version !== null && '上次成功的数据仍可使用。'}
            </p>
          )}
          {data.version !== null && (
            <>
              <h3>获权数据预览</h3>
              {!remote.value.rows.length ? (
                <p className="admin-note">本次成功取数没有记录。</p>
              ) : (
                <div className="database-table-scroll" tabIndex={0} aria-label="数据表格">
                  <table>
                    <thead>
                      <tr>
                        {data.columns.map((c) => (
                          <th key={c}>{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {remote.value.rows.map((r, index) => (
                        <tr key={index}>
                          {r.map((cell, i) => (
                            <td key={i}>{cell ?? '—'}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <Pager page={page} next={remote.value.hasMore} onPage={setPage} />
            </>
          )}
          <a
            className="button secondary"
            href={adminHref('tenant', 'database', hash, { section: 'access', connection: data.connectionId })}
          >
            查看对应接入
          </a>
        </section>
      )}
    </>
  );
}
function Connections({ tenant, hash }: { tenant: string; hash: string }) {
  const [attempt, setAttempt] = useState(0),
    refresh = () => setAttempt((n) => n + 1);
  const data = useRemote((signal) => api.connections(tenant, signal), [tenant, attempt]);
  useProgressRefresh(!!data.value?.some((c) => c.currentRun !== null), refresh);
  return (
    <section className="admin-section">
      <PageActions>
        <Button icon={RefreshCw} variant="ghost" onClick={refresh}>
          刷新
        </Button>
      </PageActions>
      <h2>数据接入</h2>
      {data.error ? (
        <Failure error={data.error} retry={refresh} />
      ) : !data.value ? (
        <Loading />
      ) : !data.value.length ? (
        <Empty
          icon={Plug}
          title="尚无可查看的接入"
          text="外部系统的连接途径和权限由项目部署维护，部署后可在这里查看状态和调整取数频率。"
        />
      ) : (
        <div className="tenant-directory-scroll">
          <div className="tenant-list-columns tenant-connection-grid">
            <span>数据接入</span>
            <span>连接状态</span>
            <span>取数频率</span>
            <span>最近运行</span>
          </div>
          <div className="admin-directory-list">
            {data.value.map((c) => (
              <a
                className="admin-directory-row tenant-connection-grid"
                key={c.id}
                href={adminHref('tenant', 'database', hash, { section: 'access', connection: c.id })}
              >
                <span>
                  <strong>{c.name}</strong>
                  <small>{c.routeLabel}</small>
                </span>
                <span>
                  <Badge>{status(c.status)}</Badge>
                </span>
                <span>{c.schedule.enabled ? frequency(c.schedule) : '已关闭'}</span>
                <span>{runStatus(c.currentRun || c.lastRun)}</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
function ConnectionDetail({ tenant, id, hash }: { tenant: string; id: string; hash: string }) {
  const [attempt, setAttempt] = useState(0),
    [editing, setEditing] = useState(false),
    [page, setPage] = useState(0),
    refresh = () => setAttempt((n) => n + 1);
  const task = useSubmission<{ expectedRevision: number }>();
  useRequestLock(task.busy || task.uncertain);
  const remote = useRemote(
    async (signal) => {
      const [connection, runs] = await Promise.all([
        api.connection(tenant, id, signal),
        api.runs(tenant, id, page * 20, signal),
      ]);
      return { connection, runs };
    },
    [tenant, id, attempt, page],
  );
  const data = remote.value?.connection;
  useProgressRefresh(!!data?.currentRun && !editing && !task.busy && !task.uncertain, refresh);
  return (
    <>
      <PageActions>
        <Button
          variant="ghost"
          icon={RefreshCw}
          disabled={editing || task.busy || task.uncertain}
          onClick={refresh}
        >
          刷新
        </Button>
      </PageActions>
      <div>
        <a className="button ghost" href={adminHref('tenant', 'database', hash, { section: 'access' })}>
          <ArrowLeft size={16} />
          返回数据接入
        </a>
      </div>
      {remote.error ? (
        <Failure error={remote.error} retry={refresh} />
      ) : !remote.value || !data ? (
        <Loading />
      ) : (
        <>
          <section className="admin-section">
            <div className="admin-section-heading">
              <h2>{data.name}</h2>
              <Badge>{status(data.status)}</Badge>
            </div>
            <dl className="database-facts">
              <div>
                <dt>取数途径</dt>
                <dd>{data.routeLabel}</dd>
              </div>
              <div>
                <dt>范围与权限</dt>
                <dd>{data.accessSummary}</dd>
              </div>
              <div>
                <dt>自动取数</dt>
                <dd>
                  {data.schedule.enabled ? '已开启' : '已关闭'} · {frequency(data.schedule)}
                </dd>
              </div>
              <div>
                <dt>时区</dt>
                <dd>{data.schedule.timeZone}</dd>
              </div>
              <div>
                <dt>当前任务</dt>
                <dd>{data.currentRun ? runStatus(data.currentRun) : '暂无运行任务'}</dd>
              </div>
              <div>
                <dt>最近成功</dt>
                <dd>{date(data.lastSuccessAt)}</dd>
              </div>
              <div>
                <dt>下次计划</dt>
                <dd>
                  {!data.schedule.enabled
                    ? '未安排（自动取数已关闭）'
                    : data.status !== 'READY'
                      ? '暂不可执行（连接不可用）'
                      : date(data.nextDue)}
                </dd>
              </div>
            </dl>
            <p className="admin-note">数据覆盖时间在对应数据集内分别展示。取数频率与画报生成频率独立。</p>
            {reason(data.lastRun) && (
              <p className="access-alert">{reason(data.lastRun)}。已有成功数据保留。</p>
            )}
            {data.canControl ? (
              <div className="form-actions">
                <Button disabled={task.busy || task.uncertain} onClick={() => setEditing(true)}>
                  调整自动取数
                </Button>
                <Button
                  variant="primary"
                  disabled={task.busy || (!task.uncertain && (data.status !== 'READY' || !!data.currentRun))}
                  onClick={() =>
                    void task.submit({ expectedRevision: data.revision }, async (body, requestId) => {
                      await api.update(tenant, id, { ...body, requestId });
                      refresh();
                    })
                  }
                >
                  {task.busy
                    ? '正在提交…'
                    : task.uncertain
                      ? '核对本次更新'
                      : data.currentRun
                        ? '更新中'
                        : '立即更新'}
                </Button>
              </div>
            ) : (
              <p className="admin-note">当前可查看获权状态，取数控制由企业负责人或企业管理员操作。</p>
            )}
            <SubmitError error={task.error} uncertain={task.uncertain} />
          </section>
          <section className="admin-section">
            <h2>更新记录</h2>
            {!remote.value.runs.length ? (
              <p className="admin-note">尚无更新记录。</p>
            ) : (
              <>
                {remote.value.runs.slice(0, 20).map((r) => (
                  <article className="admin-account-record" key={r.id}>
                    <div className="admin-section-heading">
                      <strong>{r.triggerKind === 'MANUAL' ? '手动更新' : '定时更新'}</strong>
                      <Badge>{runStatus(r)}</Badge>
                    </div>
                    <span>{date(r.startedAt || r.createdAt)}</span>
                    {reason(r) && <p>{reason(r)}</p>}
                  </article>
                ))}
                <Pager page={page} next={remote.value.runs.length > 20} onPage={setPage} />
              </>
            )}
          </section>
          {editing && (
            <ScheduleForm
              tenant={tenant}
              connection={data}
              close={() => setEditing(false)}
              saved={() => {
                setEditing(false);
                refresh();
              }}
            />
          )}
        </>
      )}
    </>
  );
}
function ScheduleForm({
  tenant,
  connection,
  close,
  saved,
}: {
  tenant: string;
  connection: DataConnection;
  close: () => void;
  saved: () => void;
}) {
  const [enabled, setEnabled] = useState(connection.schedule.enabled),
    [freq, setFreq] = useState(connection.schedule.frequency || ''),
    [time, setTime] = useState(connection.schedule.dailyTime || '');
  const [revision] = useState(connection.revision);
  const task = useSubmission<CollectionSchedule>();
  useRequestLock(task.busy || task.uncertain);
  return (
    <Modal
      title="自动取数"
      onClose={() => {
        if (!task.busy && !task.uncertain) close();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void task.submit(
            {
              enabled,
              frequency: (freq || null) as CollectionSchedule['frequency'],
              dailyTime: freq === 'DAILY' ? time : null,
              timeZone: connection.schedule.timeZone,
            },
            async (schedule, requestId) => {
              await api.configure(tenant, connection.id, { requestId, expectedRevision: revision, schedule });
              saved();
            },
          );
        }}
      >
        <fieldset disabled={task.busy || task.uncertain}>
          <label className="database-toggle">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            自动取数
          </label>
          <Field label="更新频率">
            <select
              required={enabled}
              aria-label="更新频率"
              value={freq}
              onChange={(e) => setFreq(e.target.value)}
            >
              <option value="">尚未设置</option>
              <option value="QUARTER_HOUR">每 15 分钟</option>
              <option value="HOURLY">每小时</option>
              <option value="DAILY">每天指定时间</option>
            </select>
          </Field>
          {freq === 'DAILY' && (
            <Field label={`每天执行时间（${connection.schedule.timeZone}）`}>
              <input
                type="time"
                aria-label="每天执行时间"
                required
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </Field>
          )}
        </fieldset>
        <p className="admin-note">
          时区：{connection.schedule.timeZone}
          。保存仅影响后续调度。关闭自动取数时，当前任务在授权有效的情况下继续完成，也可手动立即更新。
        </p>
        <SubmitError error={task.error} uncertain={task.uncertain} />
        <div className="form-actions">
          <Button disabled={task.busy || task.uncertain} onClick={close}>
            取消
          </Button>
          <Button type="submit" variant="primary" disabled={task.busy}>
            {task.busy ? '正在保存…' : task.uncertain ? '核对并重试' : '保存'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

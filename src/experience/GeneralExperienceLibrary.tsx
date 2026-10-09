import { Select } from '../shared/Select';
import { useEffect, useState } from 'react';
import { BookOpen, RefreshCw, Layers, Workflow, MessageSquareText } from 'lucide-react';
import { useSession } from '../identity/session';
import { IdentityError, record, uuid } from '../identity/client';
import { Badge, Button, Empty, Field, Modal, PageActions } from '../shared/ui';
import { Failure, Loading, Pager, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { pageState, textState, useViewState } from '../shared/useViewState';
import { generalExperienceClient as api, generalProcessingLabels } from './general-client';
import './management.css';
import '../operations/data-operations.css';
import {
  GeneralExperienceActivity,
  GeneralExperienceHistory,
  GeneralMethodBody,
} from './GeneralExperienceHistory';
import { PlatformExperienceAdjustmentPanel } from './PlatformExperienceAdjustmentPanel';
import { GeneralSuggestionPanel, type LocalExperienceSelection } from './GeneralSuggestionPanel';
import { requestNavigationLocked, useRequestLock } from '../shared/request-guard';
import type {
  GeneralExperienceUsageChange,
  GeneralExperienceAvailabilityChange,
} from '../../contracts/public-api/general-experience';
type Selection = { id: string; version: string };
const selectionState = (v: unknown): v is Selection | null =>
  v === null || (record(v) && uuid(v.id) && uuid(v.version));
const categories = [
  { id: 'ALL', label: '全部经验', description: '统一查看所有通用经验', icon: Layers },
  { id: 'OBSERVED_EXECUTION', label: '执行积累', description: '从实际执行中提炼的方法', icon: Workflow },
  {
    id: 'FEEDBACK_CORRECTION',
    label: '反馈纠正',
    description: '从反馈与纠错中总结的方法',
    icon: MessageSquareText,
  },
] as const;
const metricDescriptions: Record<string, string> = {
  当前可用: '已发布且来源仍可读取的通用经验，可在经验内容中查看。',
  已停用: '已停止供新任务使用、且仍可查看历史内容的通用经验。',
  来源撤回: '已撤回的通用经验条目；不再出现在可用内容列表中。',
  WAITING: '已登记并进入等待队列，尚未开始自动处理。',
  PROCESSING: '正在执行提炼、核验或发布；部分结果仍在核对。',
  RETRYING: '本次处理暂未完成，按已有重试策略等待后续执行。',
  ADMITTED: '处理已形成入库结果；不等同当前可用经验数量。',
  DUPLICATE: '已完成处理，但与已有内容重复，没有新增经验。',
  NOT_ADMITTED: '已跳过、未通过核验或发生版本冲突，没有形成入库结果。',
  UNAVAILABLE: '贡献来源已失效，相关内容无法继续处理。',
  FAILED: '处理执行失败；该计数不表示已自动恢复。',
  UNKNOWN: '执行结果尚无法确认，以后续核对结果为准。',
};
const stamp = (v: string) => new Date(v).toLocaleString('zh-CN', { hour12: false });

export function GeneralExperienceLibrary({
  tenant,
  onLocked,
  chooseLocal,
}: {
  tenant?: string;
  onLocked?: (value: boolean) => void;
  chooseLocal?: (selection: LocalExperienceSelection) => void;
}) {
  const { session } = useSession();
  const scope = tenant || 'platform';
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    onLocked?.(locked);
    return () => onLocked?.(false);
  }, [locked, onLocked]);
  const [tab, setTab] = useViewState(
    scope,
    'general:tab',
    'content',
    (v): v is string => v === 'content' || v === 'processing',
  );
  const [query, setQuery] = useViewState(scope, 'general:query', '', textState),
    [input, setInput] = useState(query);
  const [state, setState] = useViewState(
    scope,
    'general:state',
    'AVAILABLE',
    (v): v is string => v === 'AVAILABLE' || v === 'STOPPED',
  );
  const [category, setCategory] = useViewState(scope, 'general:category', 'ALL', (v): v is string =>
    categories.some((item) => item.id === v),
  );
  const activeCategory = categories.find((item) => item.id === category)!;
  const [page, setPage] = useViewState(scope, 'general:page', 0, pageState);
  const [selection, select] = useViewState<Selection | null>(
    scope,
    'general:selection',
    null,
    selectionState,
  );
  const [metric, setMetric] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const refresh = () => setAttempt((n) => n + 1);
  const refreshControl = (
    <Button icon={RefreshCw} variant="ghost" disabled={locked} onClick={refresh}>
      刷新
    </Button>
  );
  const processing = !tenant && tab === 'processing';
  const data = useRemote(
    (signal) =>
      processing
        ? Promise.resolve(null)
        : api.contents(tenant, query, state, page * 20, signal, tenant ? 'ALL' : category),
    [tenant, query, state, page, category, attempt, processing, session.identity],
  );
  const observation = useRemote(
    (signal) => (processing ? api.processing(signal) : Promise.resolve(null)),
    [processing, attempt, session.identity],
  );
  useEffect(() => {
    if (!processing || selection) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible' && !requestNavigationLocked()) setAttempt((n) => n + 1);
    }, 30000);
    return () => clearInterval(id);
  }, [processing, selection]);
  const metricLabel =
    metric && (generalProcessingLabels[metric as keyof typeof generalProcessingLabels] || metric);
  const metricValue =
    !metric || !observation.value
      ? 0
      : metric === '当前可用'
        ? observation.value.available
        : metric === '已停用'
          ? observation.value.stopped
          : metric === '来源撤回'
            ? observation.value.withdrawn
            : observation.value.counts[metric as keyof typeof generalProcessingLabels];
  const error = data.error || observation.error;
  useEffect(() => {
    if (error && !locked) select(null);
  }, [error, select, locked]);
  return (
    <div className="admin-dashboard experience-management">
      <PageActions>{refreshControl}</PageActions>
      {/* 标签保持中性按钮样式，选中效果统一由 aria-selected 驱动。 */}
      {!tenant && (
        <div
          className="experience-management-tabs experience-library-tabs"
          role="tablist"
          aria-label="通用经验库板块"
        >
          <Button
            role="tab"
            disabled={locked}
            aria-selected={!processing}
            variant="ghost"
            onClick={() => setTab('content')}
          >
            经验内容
          </Button>
          <Button
            role="tab"
            disabled={locked}
            aria-selected={processing}
            variant="ghost"
            onClick={() => setTab('processing')}
          >
            积累与改进
          </Button>
        </div>
      )}
      <div className={!tenant && !processing ? 'general-library-layout' : undefined}>
        {!tenant && !processing && (
          <aside className="general-library-categories" aria-label="经验分类">
            <header>
              <BookOpen size={18} />
              <h2>经验分类</h2>
            </header>
            <p className="muted">汇集已入库的通用经验</p>
            <nav aria-label="选择经验类别">
              {categories.map(({ id, label, description, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  disabled={locked}
                  aria-pressed={category === id}
                  onClick={() => {
                    setCategory(id);
                    setPage(0);
                    select(null);
                  }}
                >
                  <Icon size={18} />
                  <span>
                    <strong>{label}</strong>
                    <small>{description}</small>
                  </span>
                </button>
              ))}
            </nav>
            <footer>经验经脱敏和自动核验后入库</footer>
          </aside>
        )}
        <div className="general-library-results">
          {!tenant && !processing && (
            <header className="general-library-heading">
              <h2>{activeCategory.label}</h2>
              <p className="muted">{activeCategory.description} · 点击经验名称查看详情</p>
            </header>
          )}
          {processing ? (
            <p className="muted">自动脱敏、提炼和核验后的积累概况。每 30 秒更新，无需人工审核。</p>
          ) : (
            <>
              {tenant && (
                <p className="muted">经过自动脱敏、提炼和核验的通用方法。适用条件与限制随内容保留。</p>
              )}
              <form
                className="experience-management-filters"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (locked) return;
                  setQuery(input);
                  setPage(0);
                }}
              >
                <Field label="搜索通用经验">
                  <input
                    aria-label="搜索通用经验"
                    disabled={locked}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="名称、用途或标签"
                    maxLength={200}
                  />
                </Field>
                {
                  <Field label="状态">
                    <Select
                      disabled={locked}
                      aria-label="通用经验状态"
                      value={state}
                      onChange={(e) => {
                        setState(e.target.value);
                        setPage(0);
                        select(null);
                      }}
                    >
                      <option value="AVAILABLE">当前可用</option>
                      <option value="STOPPED">{tenant ? '本企业已停用' : '已停用'}</option>
                    </Select>
                  </Field>
                }
                <Button type="submit" disabled={locked}>
                  搜索
                </Button>
              </form>
            </>
          )}
          {error ? (
            <Failure error={error} retry={refresh} />
          ) : processing ? (
            !observation.value ? (
              <Loading />
            ) : (
              <>
                {!observation.value.enabled && <p role="status">自动上送尚未启用，以下保留已有处理记录。</p>}
                <div className="experience-processing-metrics">
                  {(
                    [
                      ['当前可用', observation.value.available],
                      ['已停用', observation.value.stopped],
                      ['来源撤回', observation.value.withdrawn],
                    ] as const
                  ).map(([label, value]) => (
                    <button
                      type="button"
                      className="admin-section experience-metric-card"
                      key={label}
                      disabled={locked}
                      onClick={() => setMetric(label)}
                      aria-label={`${label} ${value}，查看详情`}
                    >
                      <span>{label}</span>
                      <strong>{value}</strong>
                    </button>
                  ))}
                </div>
                <h2 className="general-experience-heading">自动处理</h2>
                <p className="muted">
                  以下按已登记的贡献来源计数；入库次数不等于当前经验数量，也不代表使用效果。
                </p>
                <div className="experience-processing-metrics">
                  {Object.entries(generalProcessingLabels).map(([key, label]) => (
                    <button
                      type="button"
                      className="admin-section experience-metric-card"
                      key={key}
                      disabled={locked}
                      onClick={() => setMetric(key)}
                      aria-label={`${label} ${observation.value!.counts[key as keyof typeof generalProcessingLabels]}，查看详情`}
                    >
                      <span>{label}</span>
                      <strong>
                        {observation.value!.counts[key as keyof typeof generalProcessingLabels]}
                      </strong>
                    </button>
                  ))}
                </div>
                <p className="muted">最近更新：{stamp(observation.value.checkedAt)}</p>
              </>
            )
          ) : !data.value ? (
            <Loading />
          ) : (
            <>
              {!tenant ? (
                <section className="data-ops-list-card" aria-label="通用经验列表">
                  <div className="data-archive-scroll">
                    <table className="data-archive-table experience-archive-table">
                      <thead>
                        <tr>
                          <th>经验名称</th>
                          <th>标签</th>
                          <th>版本</th>
                          <th>状态</th>
                          <th>最近更新</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.value.items.map((item) => (
                          <tr key={item.id}>
                            <td>
                              <Button
                                variant="ghost"
                                disabled={locked}
                                onClick={() => select({ id: item.id, version: item.versionId })}
                              >
                                <h2>{item.title}</h2>
                              </Button>
                              <small>{item.summary}</small>
                            </td>
                            <td>
                              <span className="experience-management-tags">
                                {item.tags.length
                                  ? item.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)
                                  : '—'}
                              </span>
                            </td>
                            <td>V{item.number}</td>
                            <td>
                              <Badge>{item.status === 'STOPPED' ? '已停用' : '当前可用'}</Badge>
                            </td>
                            <td>{stamp(item.updatedAt)}</td>
                            <td>
                              <Button
                                variant="ghost"
                                disabled={locked}
                                onClick={() => select({ id: item.id, version: item.versionId })}
                              >
                                查看详情
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!data.value.items.length && (
                    <p className="data-archive-empty">
                      {query
                        ? '没有匹配的通用经验'
                        : category === 'ALL'
                          ? '暂无通用经验'
                          : `暂无${activeCategory.label}经验`}
                    </p>
                  )}
                  <Pager
                    page={page}
                    next={data.value.hasMore}
                    onPage={(p) => {
                      if (!locked) setPage(p);
                    }}
                  />
                </section>
              ) : (
                <>
                  {data.value.items.length ? (
                    <div className="experience-management-list">
                      {data.value.items.map((item) => (
                        <button
                          className="experience-management-card"
                          key={item.id}
                          disabled={locked}
                          onClick={() => select({ id: item.id, version: item.versionId })}
                        >
                          <div>
                            <Badge>通用经验</Badge>
                            <span>
                              {tenant && state === 'STOPPED'
                                ? '本企业已停用'
                                : item.status === 'STOPPED'
                                  ? '已停用'
                                  : '当前可用'}{' '}
                              · v{item.number}
                            </span>
                          </div>
                          <h2>{item.title}</h2>
                          <p>{item.summary}</p>
                          <footer>
                            <span className="experience-management-tags">
                              {item.tags.map((tag) => (
                                <Badge key={tag}>{tag}</Badge>
                              ))}
                            </span>
                            <time>{stamp(item.updatedAt)}</time>
                          </footer>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <Empty
                      icon={BookOpen}
                      title={query ? '没有匹配的通用经验' : '暂无通用经验'}
                      text="满足清洗和自动核验要求的方法入库后，会显示在这里。"
                    />
                  )}
                  <Pager
                    page={page}
                    next={data.value.hasMore}
                    onPage={(p) => {
                      if (!locked) setPage(p);
                    }}
                  />
                </>
              )}
            </>
          )}
        </div>
      </div>
      {processing && metric && observation.value && !error && (
        <Modal title={`${metricLabel}详情`} onClose={() => setMetric(null)}>
          <div className="experience-metric-detail">
            <span className="muted">{metricLabel}</span>
            <strong>{metricValue}</strong>
            <p>{metricDescriptions[metric]}</p>
            <dl>
              <div>
                <dt>统计口径</dt>
                <dd>
                  {['当前可用', '已停用', '来源撤回'].includes(metric)
                    ? '通用经验条目数'
                    : '贡献来源与通用经验调整记录的处理状态合计；同一经验可能对应多条记录。'}
                </dd>
              </div>
              <div>
                <dt>自动上送</dt>
                <dd>{observation.value.enabled ? '已启用' : '尚未启用，保留已有处理记录'}</dd>
              </div>
              <div>
                <dt>最近更新</dt>
                <dd>{stamp(observation.value.checkedAt)}</dd>
              </div>
            </dl>
            {metricValue === 0 && (
              <p className="muted">
                当前没有此状态的
                {['当前可用', '已停用', '来源撤回'].includes(metric) ? '经验条目' : '处理记录'}。
              </p>
            )}
            <p className="muted">此处展示汇总详情，数量不代表使用效果。</p>
            {(metric === '当前可用' || metric === '已停用') && (
              <Button
                onClick={() => {
                  setState(metric === '当前可用' ? 'AVAILABLE' : 'STOPPED');
                  setCategory('ALL');
                  setQuery('');
                  setInput('');
                  setPage(0);
                  select(null);
                  setMetric(null);
                  setTab('content');
                }}
              >
                查看{metricLabel}经验
              </Button>
            )}
          </div>
        </Modal>
      )}
      {selection && !error && (
        <GeneralDetail
          key={selection.id + selection.version}
          tenant={tenant}
          selection={selection}
          close={() => {
            if (!locked) select(null);
          }}
          lock={setLocked}
          changed={refresh}
          chooseLocal={chooseLocal}
          chooseVersion={(version) => {
            if (!locked) {
              select({ id: selection.id, version });
              refresh();
            }
          }}
        />
      )}
    </div>
  );
}

function GeneralDetail({
  tenant,
  selection,
  close,
  lock,
  changed,
  chooseLocal,
  chooseVersion,
}: {
  tenant?: string;
  selection: Selection;
  close: () => void;
  lock: (value: boolean) => void;
  changed: () => void;
  chooseVersion: (version: string) => void;
  chooseLocal?: (selection: LocalExperienceSelection) => void;
}) {
  const [usageBlocked, setUsageBlocked] = useState(false),
    [suggestionBlocked, setSuggestionBlocked] = useState(false);
  useEffect(() => {
    lock(usageBlocked || suggestionBlocked);
    return () => lock(false);
  }, [usageBlocked, suggestionBlocked, lock]);
  const { session } = useSession();
  const [attempt, setAttempt] = useState(0);
  const data = useRemote(
    (signal) => api.detail(tenant, selection.id, selection.version, signal),
    [tenant, selection.id, selection.version, attempt, session.identity],
  );
  const d = data.value;
  const [denied, setDenied] = useState<unknown>();
  const error = data.error || denied;
  return (
    <Modal title="通用经验详情" className="experience-management-drawer" onClose={close}>
      {error ? (
        <Failure
          error={error}
          retry={() => {
            setDenied(undefined);
            setAttempt((n) => n + 1);
          }}
        />
      ) : !d ? (
        <Loading />
      ) : (
        <article className="general-experience-detail">
          <div className="experience-management-tags">
            <Badge>自动核验通过</Badge>
            <Badge>{d.status === 'STOPPED' ? '已停用' : tenant ? '通用版本可用' : '当前可用'}</Badge>
            <span>v{d.number}</span>
          </div>
          {tenant ? (
            <fieldset className="general-experience-control-group" disabled={suggestionBlocked}>
              <TenantUsage
                tenant={tenant}
                selection={selection}
                lock={setUsageBlocked}
                changed={() => {
                  setAttempt((n) => n + 1);
                  changed();
                }}
                denied={setDenied}
              />
            </fieldset>
          ) : (
            <fieldset className="general-experience-control-group" disabled={suggestionBlocked}>
              <PlatformAvailability
                selection={selection}
                lock={setUsageBlocked}
                denied={setDenied}
                changed={() => {
                  setAttempt((n) => n + 1);
                  changed();
                }}
              />
            </fieldset>
          )}

          <GeneralMethodBody method={d.method} />
          {tenant && (
            <fieldset className="general-experience-control-group" disabled={usageBlocked}>
              <GeneralSuggestionPanel
                tenant={tenant}
                entry={selection.id}
                version={selection.version}
                locked={setSuggestionBlocked}
                denied={setDenied}
                chooseLocal={chooseLocal}
              />
            </fieldset>
          )}
          {!tenant && (
            <fieldset className="general-experience-control-group" disabled={usageBlocked}>
              <PlatformExperienceAdjustmentPanel
                entry={selection.id}
                version={selection.version}
                locked={setSuggestionBlocked}
                denied={setDenied}
                chooseVersion={chooseVersion}
              />
            </fieldset>
          )}
          <GeneralExperienceActivity
            tenant={tenant}
            entry={selection.id}
            current={selection.version}
            version={selection.version}
            disabled={usageBlocked || suggestionBlocked}
            denied={setDenied}
          />
          <GeneralExperienceHistory
            tenant={tenant}
            entry={selection.id}
            current={selection.version}
            disabled={usageBlocked || suggestionBlocked}
            denied={setDenied}
          />
          <details>
            <summary>依据说明</summary>
            <p>
              {d.method.basis === 'OBSERVED_EXECUTION' ? '提炼依据为实际执行记录。' : '提炼依据为反馈纠正。'}{' '}
              自动核验通过不代表已证明所有业务效果。
            </p>
            <p className="muted">更新时间：{stamp(d.updatedAt)}</p>
          </details>
        </article>
      )}
    </Modal>
  );
}

function TenantUsage({
  tenant,
  selection,
  lock,
  changed,
  denied,
}: {
  tenant: string;
  denied: (error: unknown) => void;
  selection: Selection;
  lock: (value: boolean) => void;
  changed: () => void;
}) {
  type Action = Omit<GeneralExperienceUsageChange, 'requestId'>;
  const [attempt, setAttempt] = useState(0);
  const [action, setAction] = useState<Action | null>(null);
  const [notice, setNotice] = useState('');
  const submission = useSubmission<Action>();
  const blocked = submission.busy || submission.uncertain;
  useRequestLock(blocked);
  useEffect(() => {
    lock(blocked);
    return () => lock(false);
  }, [blocked, lock]);
  const data = useRemote(
    (signal) => api.usage(tenant, selection.id, selection.version, signal),
    [tenant, selection.id, selection.version, attempt],
  );
  const d = data.value;
  useEffect(() => {
    const e = data.error || submission.error;
    if (e instanceof IdentityError && [401, 403, 404].includes(e.status)) denied(e);
  }, [data.error, submission.error, denied]);
  return (
    <section className="experience-availability" aria-label="本企业使用状态">
      {notice && <p role="status">{notice}</p>}
      {data.error ? (
        <Failure error={data.error} retry={() => setAttempt((n) => n + 1)} />
      ) : !d ? (
        <Loading />
      ) : (
        <>
          <p>
            本企业：{d.usable ? '可供引擎参考' : d.enabled ? '关联经验已停用，当前暂停参考' : '已停止使用'}
          </p>
          {d.enabled && !d.usable && (
            <p className="muted">
              本条使用开关仍开启；关联经验恢复可用后，后续任务才可参考，已中断任务不会自动恢复。
            </p>
          )}
          {!d.canManage && <p className="muted">企业负责人或管理员可调整本企业使用状态。</p>}
          {action ? (
            <>
              <p>
                {action.enabled
                  ? '恢复本条使用开关；关联经验也可用时，后续任务才可参考。已中断的任务不会自动恢复。'
                  : '停止本企业后续检索与采用，正在引用此经验的任务需重新执行。已完成结果保留，其他企业不受影响。'}
              </p>
              <SubmitError error={submission.error} uncertain={submission.uncertain} />
              <Button
                disabled={submission.busy}
                onClick={() =>
                  void submission.submit(action, async (body, requestId) => {
                    await api.changeUsage(tenant, selection.id, { ...body, requestId });
                    setNotice('操作已确认，正在更新当前使用状态。');
                    setAction(null);
                    setAttempt((n) => n + 1);
                    changed();
                  })
                }
              >
                {submission.busy
                  ? '正在提交…'
                  : submission.uncertain
                    ? '重试原请求'
                    : action.enabled
                      ? '确认恢复'
                      : '确认停用'}
              </Button>
              <Button
                variant="ghost"
                disabled={blocked}
                onClick={() => {
                  setAction(null);
                  setAttempt((n) => n + 1);
                }}
              >
                取消
              </Button>
            </>
          ) : (
            d.canManage && (
              <Button
                variant="ghost"
                onClick={() => {
                  setNotice('');
                  setAction({
                    versionId: selection.version,
                    expectedRevision: d.revision,
                    enabled: !d.enabled,
                  });
                }}
              >
                {d.enabled ? '停止本企业使用' : '恢复本企业使用'}
              </Button>
            )
          )}
        </>
      )}
    </section>
  );
}

function PlatformAvailability({
  selection,
  lock,
  changed,
  denied,
}: {
  selection: Selection;
  lock: (value: boolean) => void;
  changed: () => void;
  denied: (error: unknown) => void;
}) {
  type Action = Omit<GeneralExperienceAvailabilityChange, 'requestId' | 'reason'>;
  const [attempt, setAttempt] = useState(0),
    [action, setAction] = useState<Action | null>(null),
    [reason, setReason] = useState('');
  const submission = useSubmission<Omit<GeneralExperienceAvailabilityChange, 'requestId'>>();
  const blocked = submission.busy || submission.uncertain;
  useRequestLock(blocked);
  useEffect(() => {
    lock(blocked);
    return () => lock(false);
  }, [blocked, lock]);
  const data = useRemote(
    (signal) => api.availability(selection.id, selection.version, signal),
    [selection.id, selection.version, attempt],
  );
  useEffect(() => {
    const e = data.error || submission.error;
    if (e instanceof IdentityError && [401, 403, 404].includes(e.status)) denied(e);
  }, [data.error, submission.error, denied]);
  const d = data.value;
  return (
    <section className="experience-availability" aria-label="总库使用状态">
      {data.error ? (
        <Failure error={data.error} retry={() => setAttempt((n) => n + 1)} />
      ) : !d ? (
        <Loading />
      ) : (
        <>
          {d.reason && <p>最近操作原因：{d.reason}</p>}
          {action ? (
            <>
              <p>
                {action.status === 'STOPPED'
                  ? '停止所有企业后续检索与采用，正在引用此经验的任务需重新执行。已完成结果保留。'
                  : '恢复当前发布版本供后续任务参考。企业自行停用的状态保持，旧任务不会自动恢复。'}
              </p>
              <Field label="操作原因">
                <textarea
                  aria-label="操作原因"
                  value={reason}
                  maxLength={500}
                  rows={3}
                  disabled={blocked}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="简要说明原因，仅总台可见"
                />
              </Field>
              <SubmitError error={submission.error} uncertain={submission.uncertain} />
              <Button
                disabled={submission.busy || !reason.trim()}
                onClick={() =>
                  void submission.submit({ ...action, reason: reason.trim() }, async (body, requestId) => {
                    await api.changeAvailability(selection.id, { ...body, requestId });
                    setAction(null);
                    setReason('');
                    changed();
                  })
                }
              >
                {submission.busy
                  ? '正在提交…'
                  : submission.uncertain
                    ? '重试原请求'
                    : action.status === 'STOPPED'
                      ? '确认停用'
                      : '确认恢复'}
              </Button>
              <Button
                variant="ghost"
                disabled={blocked}
                onClick={() => {
                  setAction(null);
                  setReason('');
                  setAttempt((n) => n + 1);
                }}
              >
                取消
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              onClick={() => {
                setReason('');
                setAction({
                  versionId: selection.version,
                  expectedRevision: d.revision,
                  status: d.status === 'AVAILABLE' ? 'STOPPED' : 'AVAILABLE',
                });
              }}
            >
              {d.status === 'AVAILABLE' ? '停用通用经验' : '恢复通用经验'}
            </Button>
          )}
        </>
      )}
    </section>
  );
}

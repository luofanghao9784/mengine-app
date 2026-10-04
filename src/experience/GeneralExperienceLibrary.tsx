import { useEffect, useState } from 'react';
import { BookOpen, RefreshCw } from 'lucide-react';
import { useSession } from '../identity/session';
import { IdentityError, record, uuid } from '../identity/client';
import { Badge, Button, Empty, Field, Modal } from '../shared/ui';
import { Failure, Loading, Pager, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { pageState, textState, useViewState } from '../shared/useViewState';
import { generalExperienceClient as api, generalProcessingLabels } from './general-client';
import './management.css';
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
  const [page, setPage] = useViewState(scope, 'general:page', 0, pageState);
  const [selection, select] = useViewState<Selection | null>(
    scope,
    'general:selection',
    null,
    selectionState,
  );
  const [attempt, setAttempt] = useState(0);
  const refresh = () => setAttempt((n) => n + 1);
  const processing = !tenant && tab === 'processing';
  const data = useRemote(
    (signal) => (processing ? Promise.resolve(null) : api.contents(tenant, query, state, page * 20, signal)),
    [tenant, query, state, page, attempt, processing, session.identity],
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
  const error = data.error || observation.error;
  useEffect(() => {
    if (error && !locked) select(null);
  }, [error, select, locked]);
  return (
    <div className="admin-dashboard experience-management">
      <div
        className="experience-management-tabs"
        role={tenant ? undefined : 'tablist'}
        aria-label="通用经验库板块"
      >
        {tenant ? (
          <strong>通用经验</strong>
        ) : (
          <>
            <Button
              role="tab"
              disabled={locked}
              aria-selected={!processing}
              variant={!processing ? 'primary' : 'ghost'}
              onClick={() => setTab('content')}
            >
              经验内容
            </Button>
            <Button
              role="tab"
              disabled={locked}
              aria-selected={processing}
              variant={processing ? 'primary' : 'ghost'}
              onClick={() => setTab('processing')}
            >
              积累与改进
            </Button>
          </>
        )}
        <Button icon={RefreshCw} variant="ghost" disabled={locked} onClick={refresh}>
          刷新
        </Button>
      </div>
      {processing ? (
        <p className="muted">自动脱敏、提炼和核验后的积累概况。每 30 秒更新，无需人工审核。</p>
      ) : (
        <>
          <p className="muted">经过自动脱敏、提炼和核验的通用方法。适用条件与限制随内容保留。</p>
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
                <select
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
                </select>
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
                <section className="admin-section" key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </section>
              ))}
            </div>
            <h2 className="general-experience-heading">自动处理</h2>
            <p className="muted">
              以下按已登记的贡献来源计数；入库次数不等于当前经验数量，也不代表使用效果。
            </p>
            <div className="experience-processing-metrics">
              {Object.entries(generalProcessingLabels).map(([key, label]) => (
                <section className="admin-section" key={key}>
                  <span>{label}</span>
                  <strong>{observation.value!.counts[key as keyof typeof generalProcessingLabels]}</strong>
                </section>
              ))}
            </div>
            <p className="muted">最近更新：{stamp(observation.value.checkedAt)}</p>
          </>
        )
      ) : !data.value ? (
        <Loading />
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

          <h2>{d.method.title}</h2>
          <p>{d.method.summary}</p>
          <div className="experience-management-tags">
            {d.method.tags.map((tag) => (
              <Badge key={tag}>{tag}</Badge>
            ))}
          </div>
          <h3>方法步骤</h3>
          <ol>
            {d.method.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <h3>适用条件</h3>
          <ul>
            {d.method.applicable.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
          <h3>限制</h3>
          <ul>
            {d.method.excluded.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
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
          <p>本企业：{d.enabled ? '可供引擎参考' : '已停止使用'}</p>
          {!d.canManage && <p className="muted">企业负责人或管理员可调整本企业使用状态。</p>}
          {action ? (
            <>
              <p>
                {action.enabled
                  ? '恢复后，后续任务可参考此经验；已中断的任务不会自动恢复。'
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

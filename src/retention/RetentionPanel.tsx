import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ClipboardCheck, Clock3, FileClock, RefreshCw, ShieldCheck } from 'lucide-react';
import type {
  CheckStatus,
  RetentionCase,
  RetentionCatalogue,
  RetentionCheck,
  RetentionCommand,
  RetentionKind,
  RetentionPolicy,
  RetentionSpace,
} from '../../contracts/public-api/retention';
import { useSession } from '../identity/session';
import { IdentityError } from '../identity/client';
import { Button, Field } from '../shared/ui';
import {
  Failure,
  Loading,
  MutationGate,
  Pager,
  SubmitError,
  useRemote,
  useSubmission,
} from '../shared/admin';
import { retentionClient as api } from './client';
import { useRequestLock } from '../shared/request-guard';
import { OperationRetentionStatus } from './OperationRetentionStatus';
import './retention.css';
const Busy = createContext(false),
  Locks = createContext<(id: symbol, on: boolean) => void>(() => {});
function useLock(on: boolean) {
  const id = useRef(Symbol()),
    register = useContext(Locks);
  useEffect(() => {
    if (on) {
      register(id.current, true);
      return () => register(id.current, false);
    }
  }, [on, register]);
}
const when = (value: string | null) => (value ? new Date(value).toLocaleString('zh-CN') : '默认政策');
const states = { DRAFT: '准备中', ASSESSED: '已评估，尚未执行', CANCELLED: '已取消准备' };
const enforcement: Record<string, string> = {
  NO_AUTOMATIC_EXPIRY: '不按访问时间自动删除',
  NOT_CONNECTED: '历史记录：当时到期执行器待接通',
  DEPARTURE_FIXED_WINDOW: '正式办理时固定期限，隔离、停业务及到期清理已接通',
  MATERIAL_FIXED_30_DAYS: '资料现执行固定 30 天回收期',
  EXPORT_SELECTED_1_3_7_DAYS: '现按每个包选择的 1 / 3 / 7 天清理',
  MATERIAL_DEPENDENCY_GUARD: '资料来源失效时阻断受限内容',
  MATERIAL_POLICY_WINDOW: '新资料回收截止已按政策固定',
  EXPORT_POLICY_WINDOW: '新导出包已按政策上限执行，重试不续期',
  CLOSED_TASK_NOTIFICATIONS: '新闭合任务通知按原截止实际清理',
  OBJECT_POLICY_WINDOW: '新版本按原始事件与采用政策执行到期清理',
  EVALUATION_DETAIL_WINDOW: '明确归为试验的详情按原生成时间清理，保留判断分母',
  PLATFORM_LOG_WINDOW: '平台技术日志固定保留上限与分段清理',
  OBJECT_AND_MATERIAL_WINDOW: '新对象与资料回收均按当时政策固定截止',
  DEPENDENCY_CHAIN_GUARD: '来源及实际读取依赖失效时同步停读与清理',
};
const support: Record<string, string> = {
  SINGLE_ITEM_DOWNLOAD: '可逐项下载',
  EXISTING_RESULT_BATCH: '可用现有成果分包',
  BULK_CAPABILITY_REQUIRED: '缺少批量导出资格',
  NOT_IMPLEMENTED: '历史评估：当时迁出包尚未支持',
  EXIT_INVENTORY_AFTER_START: '正式退出后由指定人员生成迁出包',
  NOT_INCLUDED: '不包含在本次清单',
};
const blockers: Record<string, string> = {
  EXECUTION_NOT_CONNECTED: '历史评估：当时正式执行器尚未接通',
  EXPLICIT_EXECUTION_REQUIRED: '准备核对已保存；仍需在离职与企业退出入口明确办理',
  NOT_FULL_TENANT_MIGRATION: '本次是所选获权共享范围，不能证明全企业迁出完整',
  EXPERIENCE_EXPORT_NOT_CONNECTED: '历史评估：当时经验迁出包尚未支持',
  BACKUP_CLOSURE_NOT_VERIFIED: '备份副本闭合需要独立核验',
  MANUAL_CHECKS_INCOMPLETE: '仍有人工核对项未确认',
  UNFINISHED_TASKS_PRESENT: '所选范围存在尚未闭合的任务',
  ACTIVE_PLANS_PRESENT: '所选范围存在仍在运行的持续计划',
  NO_AUTHORIZED_SHARED_SCOPE_SELECTED: '尚未选择可读的共享空间',
  PRIVATE_ISOLATION_AND_CLEANUP_NOT_CONNECTED: '历史评估：当时离职隔离清理尚未接通',
  OWNER_HANDOVER_REQUIRED: '目标成员是企业所有者，须先完成所有者移交',
};
const jobStates = { QUEUED: '清理排队', CLEANING: '正在清理', FAILED: '清理失败', COMPLETE: '在线清理完成' };
export interface RetentionPanelProps {
  tenant: string;
  verification?: unknown;
  onOpenWorkspace?: (id: string) => void;
  onOpenExports?: (id: string) => void;
  onOpenCleanup?: (workspace: string, job: string) => void;
}
/** Shared enterprise management view. Never assumes an admin has private content or export access. */
export function RetentionPanel(props: RetentionPanelProps) {
  const { session } = useSession();
  return session.identity ? (
    <Panel key={`${session.identity.account.id}:${props.tenant}`} {...props} />
  ) : null;
}
function Panel(props: RetentionPanelProps) {
  const { tenant, verification } = props,
    { session } = useSession(),
    outer = useContext(MutationGate);
  const [transient, setTransient] = useState(false),
    [locks, setLocks] = useState<Set<symbol>>(() => new Set()),
    [attempt, setAttempt] = useState(0),
    [tab, setTab] = useState<'policies' | 'cases'>('policies'),
    [policy, setPolicy] = useState<string>(),
    [selected, setSelected] = useState<string>(),
    [creating, setCreating] = useState(false),
    [denied, setDenied] = useState<unknown>();
  const register = useCallback(
      (key: symbol, on: boolean) =>
        setLocks((previous) => {
          const next = new Set(previous);
          if (on) next.add(key);
          else next.delete(key);
          return next;
        }),
      [],
    ),
    blocked = transient || locks.size > 0;
  useRequestLock(blocked);
  useEffect(() => {
    outer(blocked);
    return () => outer(false);
  }, [outer, blocked]);
  const refresh = () => {
    setDenied(undefined);
    setAttempt((n) => n + 1);
  };
  useEffect(() => {
    const focus = () => {
      if (!blocked) refresh();
    };
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [blocked]);
  useEffect(() => setDenied(undefined), [verification, session.identity]);
  const catalogue = useRemote(
    (signal) => api.catalogue(tenant, signal),
    [tenant, attempt, verification, session.identity],
  );
  const fail = useCallback((e: unknown) => {
    if (e instanceof IdentityError && [401, 403, 404].includes(e.status)) {
      setDenied(e);
      setPolicy(undefined);
      setSelected(undefined);
      setCreating(false);
    }
  }, []);
  if (denied)
    return (
      <section className="retention-panel">
        <Failure error={denied} retry={refresh} />
      </section>
    );
  return (
    <MutationGate.Provider value={setTransient}>
      <Locks.Provider value={register}>
        <Busy.Provider value={blocked}>
          <section className="retention-panel" data-retention-tenant={tenant}>
            <header className="retention-heading">
              <div>
                <h2>
                  <ShieldCheck size={22} /> 生命周期与退出准备
                </h2>
                <p>把保存政策、当前能力和实际执行回执分别核对。</p>
              </div>
              <Button icon={RefreshCw} aria-label="刷新生命周期" disabled={blocked} onClick={refresh} />
            </header>
            <p className="retention-notice">
              这里的准备记录不暂停成员或后台任务，也不代表企业已经退出。所有期限按服务器时间计算；读取、重试和导出不会延长已有数据的保留期。
            </p>
            {catalogue.error ? (
              <Failure error={catalogue.error} retry={refresh} />
            ) : !catalogue.value ? (
              <Loading />
            ) : (
              <>
                <nav className="retention-tabs" aria-label="生命周期视图">
                  <Button
                    variant={tab === 'policies' ? 'primary' : 'ghost'}
                    icon={Clock3}
                    disabled={blocked}
                    onClick={() => setTab('policies')}
                  >
                    保存与删除政策
                  </Button>
                  {(catalogue.value.canOffboard || catalogue.value.canExit) && (
                    <Button
                      variant={tab === 'cases' ? 'primary' : 'ghost'}
                      icon={ClipboardCheck}
                      disabled={blocked}
                      onClick={() => setTab('cases')}
                    >
                      离职与企业退出准备
                    </Button>
                  )}
                </nav>
                {tab === 'policies' ? (
                  <>
                    {catalogue.value.canConfigure && (
                      <OperationRetentionStatus tenant={tenant} revision={attempt} />
                    )}
                    {policy && (
                      <PolicyEditor
                        key={policy + attempt}
                        tenant={tenant}
                        policy={catalogue.value.items.find((p) => p.definition.key === policy)!}
                        canConfigure={catalogue.value.canConfigure}
                        onDenied={fail}
                        done={() => {
                          setPolicy(undefined);
                          refresh();
                        }}
                        close={() => setPolicy(undefined)}
                      />
                    )}
                    <div className="retention-policy-grid">
                      {catalogue.value.items.map((item) => (
                        <article className="retention-policy" key={item.definition.key}>
                          <div className="retention-policy-title">
                            <h3>{item.definition.label}</h3>
                            <span>
                              {item.configuredDays === null ? '按有效目的保留' : `${item.configuredDays} 天`}
                            </span>
                          </div>
                          <p>
                            {enforcement[item.definition.currentEnforcement] ??
                              item.definition.currentEnforcement}
                          </p>
                          <small>
                            登记版本 {item.revision} · {when(item.effectiveAt)}
                          </small>
                          <details>
                            <summary>实际执行范围</summary>
                            <p>
                              {item.definition.remainingAdapter}
                              。新事件采用当时政策固定截止，修改政策不改变已存在对象的原截止。
                            </p>
                          </details>
                          <Button disabled={blocked} onClick={() => setPolicy(item.definition.key)}>
                            {catalogue.value!.canConfigure && item.definition.configurable
                              ? '配置与历史'
                              : '查看政策历史'}
                          </Button>
                        </article>
                      ))}
                    </div>
                  </>
                ) : (
                  <Cases
                    key={String(verification)}
                    tenant={tenant}
                    catalogue={catalogue.value}
                    attempt={attempt}
                    selected={selected}
                    select={(id) => {
                      setSelected(id);
                      setCreating(false);
                    }}
                    creating={creating}
                    setCreating={setCreating}
                    refresh={refresh}
                    onDenied={fail}
                    {...{ props }}
                  />
                )}
              </>
            )}
          </section>
        </Busy.Provider>
      </Locks.Provider>
    </MutationGate.Provider>
  );
}
function PolicyEditor({
  tenant,
  policy,
  canConfigure,
  onDenied,
  done,
  close,
}: {
  tenant: string;
  policy: RetentionPolicy;
  canConfigure: boolean;
  onDenied: (e: unknown) => void;
  done: () => void;
  close: () => void;
}) {
  const element = useRef<HTMLElement>(null);
  useEffect(() => {
    element.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, []);
  const busy = useContext(Busy),
    sub = useSubmission<{ expectedRevision: number; days: number; reason: string }>(),
    [days, setDays] = useState(policy.configuredDays ?? 30),
    [reason, setReason] = useState(''),
    [page, setPage] = useState(0),
    [retry, setRetry] = useState(0);
  useLock(sub.busy || sub.uncertain);
  useEffect(() => onDenied(sub.error), [sub.error, onDenied]);
  const history = useRemote(
    (signal) => api.policyHistory(tenant, policy.definition.key, page * 20, signal),
    [tenant, policy.definition.key, page, retry],
  );
  return (
    <section ref={element} className="retention-editor" aria-label="政策配置与历史">
      <header>
        <h3>{policy.definition.label}</h3>
        <Button disabled={busy} onClick={close}>
          收起
        </Button>
      </header>
      <p>
        变更仅用于之后新产生的记录。当前实际执行：{enforcement[policy.definition.currentEnforcement]}
        。不自动缩短现存对象期限，不恢复已删除内容。
      </p>
      {canConfigure && policy.definition.configurable && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sub.submit({ expectedRevision: policy.revision, days, reason }, async (body, requestId) => {
              await api.configure(tenant, policy.definition.key, { ...body, requestId });
              done();
            });
          }}
        >
          <fieldset disabled={busy}>
            <Field label="后续新对象的保留天数">
              <input
                type="number"
                min={1}
                max={
                  policy.definition.key === 'EXPORT_PACKAGE'
                    ? 7
                    : ['TRASH', 'OFFBOARD_ISOLATION', 'TENANT_EXIT_WINDOW'].includes(policy.definition.key)
                      ? 365
                      : 3650
                }
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                required
              />
            </Field>
            <Field label="修改原因">
              <textarea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                required
                placeholder="说明后续新对象的保存目的，不填写私人内容"
              />
            </Field>
          </fieldset>
          <SubmitError error={sub.error} uncertain={sub.uncertain} />
          <Button type="submit" variant="primary" disabled={sub.busy || (busy && !sub.uncertain)}>
            {sub.uncertain ? '核对并重试原请求' : '保存政策登记'}
          </Button>
        </form>
      )}
      <h4>配置历史</h4>
      {history.error ? (
        <Failure error={history.error} retry={() => setRetry((n) => n + 1)} />
      ) : !history.value ? (
        <Loading />
      ) : (
        <>
          <div className="retention-history">
            {history.value.items.length === 0 ? (
              <p>尚未修改，使用开发默认政策。</p>
            ) : (
              history.value.items.map((p) => (
                <article key={p.revision}>
                  <strong>
                    登记版本 {p.revision} · {p.configuredDays} 天
                  </strong>
                  <span>
                    {when(p.effectiveAt)} · 修改人 {p.changedBy}
                  </span>
                  <p>{p.reason}</p>
                </article>
              ))
            )}
          </div>
          <fieldset disabled={busy}>
            <Pager page={page} next={history.value.hasMore} onPage={setPage} />
          </fieldset>
        </>
      )}
    </section>
  );
}
function Cases({
  tenant,
  catalogue,
  attempt,
  selected,
  select,
  creating,
  setCreating,
  refresh,
  onDenied,
  props,
}: {
  tenant: string;
  catalogue: RetentionCatalogue;
  attempt: number;
  selected?: string;
  select: (id: string) => void;
  creating: boolean;
  setCreating: (on: boolean) => void;
  refresh: () => void;
  onDenied: (e: unknown) => void;
  props: RetentionPanelProps;
}) {
  const busy = useContext(Busy),
    [page, setPage] = useState(0);
  const items = useRemote((signal) => api.list(tenant, page * 20, signal), [tenant, page, attempt]);
  return (
    <>
      <div className="retention-section-heading">
        <div>
          <h3>准备记录</h3>
          <p>明确目标成员或企业退出范围，保存人工核对及系统评估的版本。</p>
        </div>
        <Button variant="primary" disabled={busy} onClick={() => setCreating(!creating)}>
          {creating ? '收起新建' : '新建准备记录'}
        </Button>
      </div>
      {creating && (
        <CreateCase
          tenant={tenant}
          catalogue={catalogue}
          onDenied={onDenied}
          done={(id) => {
            select(id);
            refresh();
          }}
        />
      )}
      {items.error ? (
        <Failure error={items.error} retry={refresh} />
      ) : !items.value ? (
        <Loading />
      ) : (
        <>
          <div className="retention-cases">
            {items.value.items.length === 0 ? (
              <p className="retention-muted">尚无准备记录。创建和评估不会更改成员或企业运行状态。</p>
            ) : (
              items.value.items.map((c) => (
                <button
                  key={c.id}
                  className={'retention-case ' + (selected === c.id ? 'selected' : '')}
                  disabled={busy}
                  onClick={() => select(c.id)}
                >
                  <span>
                    {c.kind === 'TENANT_EXIT' ? '企业退出准备' : '员工离职准备'} · 版本 {c.revision}
                  </span>
                  <strong>{c.label}</strong>
                  <small>
                    {states[c.state]} · {when(c.changedAt)}
                  </small>
                </button>
              ))
            )}
          </div>
          <fieldset disabled={busy}>
            <Pager page={page} next={items.value.hasMore} onPage={setPage} />
          </fieldset>
        </>
      )}
      {selected && !creating && (
        <CaseView
          key={selected + ':' + attempt}
          tenant={tenant}
          id={selected}
          refresh={refresh}
          onDenied={onDenied}
          props={props}
        />
      )}
    </>
  );
}
function CreateCase({
  tenant,
  catalogue,
  onDenied,
  done,
}: {
  tenant: string;
  catalogue: RetentionCatalogue;
  onDenied: (e: unknown) => void;
  done: (id: string) => void;
}) {
  const busy = useContext(Busy),
    sub = useSubmission<{
      kind: RetentionKind;
      targetAccountId: string | null;
      label: string;
      workspaceIds: string[];
    }>();
  const [kind, setKind] = useState<RetentionKind>(catalogue.canExit ? 'TENANT_EXIT' : 'MEMBER_OFFBOARD'),
    [label, setLabel] = useState(''),
    [target, setTarget] = useState(''),
    [memberPage, setMemberPage] = useState(0),
    [spacePage, setSpacePage] = useState(0),
    [chosen, setChosen] = useState<RetentionSpace[]>([]),
    [selectedName, setSelectedName] = useState(''),
    [retry, setRetry] = useState(0);
  useLock(sub.busy || sub.uncertain);
  useEffect(() => onDenied(sub.error), [sub.error, onDenied]);
  const options = useRemote(
    (signal) => api.options(tenant, kind, memberPage * 20, spacePage * 20, signal),
    [tenant, kind, memberPage, spacePage, retry],
  );
  return (
    <form
      className="retention-editor"
      aria-label="新建生命周期准备"
      onSubmit={(e) => {
        e.preventDefault();
        void sub.submit(
          {
            kind,
            targetAccountId: kind === 'MEMBER_OFFBOARD' ? target : null,
            label,
            workspaceIds: chosen.map((s) => s.id),
          },
          async (body, requestId) => {
            const result = await api.create(tenant, { ...body, requestId });
            done(result.summary.id);
          },
        );
      }}
    >
      <fieldset disabled={busy}>
        <div className="retention-fields">
          <Field label="准备类型">
            <select
              aria-label="准备类型"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as RetentionKind);
                setTarget('');
                setSelectedName('');
                setMemberPage(0);
              }}
            >
              {catalogue.canExit && <option value="TENANT_EXIT">企业退出准备</option>}
              {catalogue.canOffboard && <option value="MEMBER_OFFBOARD">员工离职准备</option>}
            </select>
          </Field>
          <Field label="记录名称">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={100}
              required
              placeholder="例如：十月离职与共享责任核对"
            />
          </Field>
        </div>
        {options.error ? (
          <Failure
            error={options.error}
            retry={() => {
              setRetry((n) => n + 1);
            }}
          />
        ) : !options.value ? (
          <Loading />
        ) : (
          <>
            {kind === 'MEMBER_OFFBOARD' && (
              <>
                <Field label="目标员工">
                  <select
                    aria-label="目标员工"
                    value={target}
                    onChange={(e) => {
                      setTarget(e.target.value);
                      setSelectedName(
                        options.value?.members.find((m) => m.id === e.target.value)?.name ?? '',
                      );
                    }}
                    required
                  >
                    <option value="">明确选择目标员工</option>
                    {target && !options.value.members.some((m) => m.id === target) && (
                      <option value={target}>{selectedName}（已选）</option>
                    )}
                    {options.value.members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} · {m.status === 'ACTIVE' ? '当前可用' : '已停用'} · {m.id.slice(0, 8)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Pager page={memberPage} next={options.value.hasMore} onPage={setMemberPage} />
              </>
            )}
            <h4>选择当前可读的共享空间</h4>
            <p className="retention-muted">
              最多 50 个。私人空间不进入企业迁出；未选范围不会被默认为已经评估。
            </p>
            <div className="retention-scope-choices">
              {options.value.spaces.length === 0 ? (
                <p>当前没有可读的共享空间。仍可保存范围缺失的准备记录。</p>
              ) : (
                options.value.spaces.map((s) => (
                  <label key={s.id}>
                    <input
                      type="checkbox"
                      checked={chosen.some((v) => v.id === s.id)}
                      disabled={!chosen.some((v) => v.id === s.id) && chosen.length >= 50}
                      onChange={(e) =>
                        setChosen((old) =>
                          e.target.checked ? [...old, s] : old.filter((v) => v.id !== s.id),
                        )
                      }
                    />
                    <span>{s.name}</span>
                  </label>
                ))
              )}
            </div>
            <Pager page={spacePage} next={options.value.spacesHaveMore} onPage={setSpacePage} />
            <div className="retention-selected">
              <strong>已选 {chosen.length} 个空间</strong>
              {chosen.map((s) => (
                <Button
                  key={s.id}
                  variant="ghost"
                  onClick={() => setChosen((old) => old.filter((v) => v.id !== s.id))}
                >
                  {s.name} ×
                </Button>
              ))}
            </div>
          </>
        )}
      </fieldset>
      <SubmitError error={sub.error} uncertain={sub.uncertain} />
      <Button
        type="submit"
        variant="primary"
        disabled={
          sub.busy || (busy && !sub.uncertain) || !options.value || (kind === 'MEMBER_OFFBOARD' && !target)
        }
      >
        {sub.uncertain ? '核对并重试原请求' : '保存准备记录'}
      </Button>
      <small className="retention-footnote">只创建准备记录，不停止账号、后台计划或企业业务。</small>
    </form>
  );
}
function CaseView({
  tenant,
  id,
  refresh,
  onDenied,
  props,
}: {
  tenant: string;
  id: string;
  refresh: () => void;
  onDenied: (e: unknown) => void;
  props: RetentionPanelProps;
}) {
  const busy = useContext(Busy),
    [revision, setRevision] = useState<number>(),
    [historyPage, setHistoryPage] = useState(0);
  const detail = useRemote((signal) => api.get(tenant, id, revision, signal), [tenant, id, revision]),
    history = useRemote(
      (signal) => api.history(tenant, id, historyPage * 20, signal),
      [tenant, id, historyPage],
    );
  if (detail.error) return <Failure error={detail.error} retry={refresh} />;
  if (!detail.value) return <Loading />;
  const data = detail.value;
  return (
    <section className="retention-editor" aria-label="准备记录详情">
      <header>
        <div>
          <h3>{data.summary.label}</h3>
          <p>
            {states[data.versionState]} · 查看版本 {data.acceptedRevision} / 最新版本 {data.summary.revision}
          </p>
        </div>
        <FileClock size={24} />
      </header>
      <p>
        {data.summary.kind === 'MEMBER_OFFBOARD'
          ? `目标员工：${data.targetName ?? data.summary.targetAccountId} · 当前身份 ${data.targetStatus === 'ACTIVE' ? '可用' : data.targetStatus === 'DISABLED' ? '已停用' : '未知'}。这里只显示当前身份，不把停用推断为已正式离职。`
          : '企业退出准备：当前没有启动受限导出窗口或停止新业务。'}
      </p>
      <p className="retention-muted">
        所选空间：{data.selectedScopes.map((s) => s.name).join('、') || '当前无可展示范围'}
        {data.restrictedScopeCount > 0 ? `；另有 ${data.restrictedScopeCount} 个范围已无权查看。` : ''}
      </p>
      {data.acceptedRevision === data.summary.revision && data.summary.state !== 'CANCELLED' ? (
        <CaseActions
          key={data.summary.id + ':' + data.summary.revision}
          tenant={tenant}
          data={data}
          done={refresh}
          onDenied={onDenied}
        />
      ) : (
        <div className="retention-checks">
          {data.checklist.map((c) => (
            <p key={c.key}>
              <strong>{data.checkDefinitions.find((v) => v.key === c.key)?.label}</strong>
              <span>
                {c.status === 'CONFIRMED'
                  ? '人工已核对'
                  : c.status === 'NOT_APPLICABLE'
                    ? '人工标记不适用'
                    : '待人工核对'}
              </span>
            </p>
          ))}
        </div>
      )}
      {data.assessment ? (
        <Assessment data={data} props={props} />
      ) : (
        <p className="retention-notice">
          此版本未保存系统评估。人工核对不等于业务已执行；点击“评估当前范围”会保存本次授权、数量与缺口快照。
        </p>
      )}
      <details className="retention-history-disclosure">
        <summary>准备记录版本历史</summary>
        {history.error ? (
          <Failure error={history.error} retry={refresh} />
        ) : !history.value ? (
          <Loading />
        ) : (
          <>
            <div className="retention-history">
              {history.value.items.map((v) => (
                <article key={v.revision}>
                  <strong>
                    版本 {v.revision} · {states[v.state]}
                  </strong>
                  <span>
                    {when(v.createdAt)} · 操作人 {v.changedBy}
                  </span>
                  <Button disabled={busy} onClick={() => setRevision(v.revision)}>
                    查看版本 {v.revision}
                  </Button>
                </article>
              ))}
            </div>
            <fieldset disabled={busy}>
              <Pager page={historyPage} next={history.value.hasMore} onPage={setHistoryPage} />
            </fieldset>
          </>
        )}
        {revision && (
          <Button disabled={busy} onClick={() => setRevision(undefined)}>
            返回最新记录
          </Button>
        )}
      </details>
    </section>
  );
}
function CaseActions({
  tenant,
  data,
  done,
  onDenied,
}: {
  tenant: string;
  data: RetentionCase;
  done: () => void;
  onDenied: (e: unknown) => void;
}) {
  const busy = useContext(Busy),
    sub = useSubmission<Omit<RetentionCommand, 'requestId'>>(),
    [checks, setChecks] = useState<RetentionCheck[]>(data.checklist),
    [pending, setPending] = useState<Omit<RetentionCommand, 'requestId'>>();
  useLock(sub.busy || sub.uncertain);
  useEffect(() => onDenied(sub.error), [sub.error, onDenied]);
  const dirty = JSON.stringify(checks) !== JSON.stringify(data.checklist);
  const run = (body: Omit<RetentionCommand, 'requestId'>) => {
    setPending(body);
    void sub.submit(body, async (value, requestId) => {
      await api.command(tenant, data.summary.id, { ...value, requestId });
      done();
    });
  };
  return (
    <div className="retention-case-actions">
      <fieldset disabled={busy || data.restrictedScopeCount > 0}>
        <div className="retention-checks">
          {data.checkDefinitions.map((def) => (
            <Field key={def.key} label={def.label}>
              <select
                aria-label={def.label}
                value={checks.find((c) => c.key === def.key)?.status ?? 'UNCONFIRMED'}
                onChange={(e) =>
                  setChecks((old) =>
                    old.map((c) => (c.key === def.key ? { ...c, status: e.target.value as CheckStatus } : c)),
                  )
                }
              >
                <option value="UNCONFIRMED">待人工核对</option>
                <option value="CONFIRMED">人工已核对</option>
                <option value="NOT_APPLICABLE">人工标记不适用</option>
              </select>
            </Field>
          ))}
        </div>
      </fieldset>
      <p className="retention-muted">
        核对结果是操作人的声明，不证明已移交、已导出、已停用或已清理。修改核对项后，请先保存再评估。
      </p>
      <SubmitError error={sub.error} uncertain={sub.uncertain} />
      <div className="retention-action-row">
        {sub.uncertain && pending ? (
          <Button variant="primary" disabled={sub.busy} onClick={() => run(pending)}>
            核对并重试原请求
          </Button>
        ) : (
          <>
            <Button
              disabled={busy || !dirty || data.restrictedScopeCount > 0}
              onClick={() =>
                run({ expectedRevision: data.summary.revision, action: 'CHECK', checklist: checks })
              }
            >
              保存人工核对
            </Button>
            <Button
              variant="primary"
              disabled={busy || dirty || data.restrictedScopeCount > 0}
              onClick={() => run({ expectedRevision: data.summary.revision, action: 'ASSESS' })}
            >
              评估当前范围
            </Button>
            <Button
              disabled={busy}
              onClick={() => run({ expectedRevision: data.summary.revision, action: 'CANCEL' })}
            >
              取消准备记录
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
function Assessment({ data, props }: { data: RetentionCase; props: RetentionPanelProps }) {
  const busy = useContext(Busy),
    a = data.assessment!;
  return (
    <section className="retention-assessment" aria-label="退出范围评估">
      <header>
        <div>
          <h3>范围与缺项清单</h3>
          <p>评估于 {when(a.assessedAt)}；这是当时的快照，当前权限仍会重新核对。</p>
        </div>
        <span className="retention-status">尚不支持完整迁出</span>
      </header>
      <div className="retention-blockers">
        <h4>执行前仍需补齐</h4>
        <ul>
          {a.blockers.map((b) => (
            <li key={b}>{blockers[b] ?? b}</li>
          ))}
        </ul>
      </div>
      {a.restrictedScopeCount > 0 && (
        <p className="access-alert">
          {a.restrictedScopeCount} 个历史范围已隐藏，不能使用旧快照旁路当前权限。
        </p>
      )}
      {a.scopes.map((s) => (
        <article className="retention-assessed-scope" key={s.workspaceId}>
          <header>
            <h4>{s.name}</h4>
            {props.onOpenWorkspace && (
              <Button disabled={busy} onClick={() => props.onOpenWorkspace?.(s.workspaceId)}>
                打开资料库
              </Button>
            )}
          </header>
          <p>
            未闭合任务 {s.unfinishedTasks ?? '待接通统计'} · 活跃持续计划 {s.activePlans ?? '待接通统计'}
            。没有自动暂停或重启。
          </p>
          <div className="retention-group-grid">
            {s.groups.map((g) => (
              <div key={g.key}>
                <strong>
                  {g.label}
                  <span>{g.count === null ? '未统计' : g.count}</span>
                </strong>
                <small>{support[g.exportSupport]}</small>
                <p>{g.scopeNote}</p>
                {g.exportSupport === 'EXISTING_RESULT_BATCH' && props.onOpenExports && (
                  <Button disabled={busy} onClick={() => props.onOpenExports?.(s.workspaceId)}>
                    选择成果分包
                  </Button>
                )}
              </div>
            ))}
          </div>
          <details>
            <summary>
              已存在的资料清理回执（{s.cleanup.length}
              {s.cleanupHasMore ? '+' : ''}）
            </summary>
            {s.cleanup.length === 0 ? (
              <p>此快照中没有资料清理作业；这不代表所有对象均已清理。</p>
            ) : (
              s.cleanup.map((j) => (
                <div className="retention-cleanup" key={j.id}>
                  <strong>
                    {jobStates[j.state]} · 尝试 {j.attempts} 次
                  </strong>
                  <span>
                    {j.completedAt ? '实际完成 ' + when(j.completedAt) : '尚未确认完成'}
                    {j.errorCode ? ` · ${j.errorCode}` : ''}
                  </span>
                  <small>仅在线清理；备份闭合另行核验。</small>
                  {props.onOpenCleanup && (
                    <Button disabled={busy} onClick={() => props.onOpenCleanup?.(s.workspaceId, j.id)}>
                      查看当前清理回执
                    </Button>
                  )}
                </div>
              ))
            )}
          </details>
        </article>
      ))}
      <details open>
        <summary>本次不包含的范围</summary>
        <ul>
          {a.exclusions.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      </details>
      <details>
        <summary>评估引用的政策版本</summary>
        <div className="retention-policy-stamps">
          {Object.entries(a.policyRevisions).map(([key, rev]) => (
            <span key={key}>
              {key} · {rev}
            </span>
          ))}
        </div>
      </details>
    </section>
  );
}

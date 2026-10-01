import { LiveConversationDeck } from '../conversation/LiveConversationDeck';
import { conversationHref } from '../conversation/Conversations';
import { RequestPending, requestNavigationLocked, useRequestLock } from '../shared/request-guard';
import { useContext } from 'react';
import { useEffect, useState } from 'react';
import type { Plan, PlanAction, PlanConfiguration } from '../../contracts/public-api/plans';
import { identityClient, useSession } from '../identity/session';
import { Badge, Button, Field, Modal } from '../shared/ui';
import { Failure, FormActions, Loading, Pager, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { planClient as api, reasonLabels, runtimeLabels, statusLabels } from './client';
import './plans.css';

const date = (value: string | null, zone?: string) =>
  value
    ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', timeZone: zone }).format(
        new Date(value),
      )
    : '暂无';
const localInput = (value: string) => {
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const behavior = (value: string) => (value === 'SOURCE_LOOKUP' ? '检索资料依据' : 'AI 分析并给出建议');
export function Plans({ tenant }: { tenant: string }) {
  const pendingRequest = useContext(RequestPending);
  const { session } = useSession(),
    owner = session.identity!.account.id;
  const [refresh, setRefresh] = useState(0),
    [page, setPage] = useState(0),
    [selected, setSelected] = useState<string | null>(() =>
      new URLSearchParams(location.hash.slice(1)).get('plan'),
    ),
    [editing, setEditing] = useState<Plan | 'new' | null>(null);
  useEffect(() => {
    const change = () => {
      if (!requestNavigationLocked()) setSelected(new URLSearchParams(location.hash.slice(1)).get('plan'));
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, [tenant]);
  const context = useRemote((signal) => identityClient.context(tenant, signal), [tenant, session.identity]);
  const listing = useRemote(
    (signal) => api.list(tenant, owner, page * 20, signal),
    [tenant, owner, page, refresh, session.identity],
  );
  const changed = () => setRefresh((x) => x + 1);
  return (
    <section className="access-panel plans-panel">
      <header className="plans-heading">
        <div>
          <h2>我的持续计划</h2>
          <p className="muted">保存一次明确委托，按时间或资料变化持续检查。关闭页面不会停止计划。</p>
        </div>
        <div className="plans-actions">
          <Button disabled={pendingRequest} onClick={changed}>
            刷新状态
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              location.hash = conversationHref(tenant);
            }}
            disabled={!context.value || pendingRequest}
          >
            新建计划
          </Button>
        </div>
      </header>
      {context.error ? (
        <Failure error={context.error} retry={changed} />
      ) : listing.error ? (
        <Failure error={listing.error} retry={changed} />
      ) : !listing.value || !context.value ? (
        <Loading />
      ) : (
        <>
          {!listing.value.items.length && (
            <p className="plans-empty">尚无持续计划。普通会话无需创建计划，只有明确要持续关注时再启用。</p>
          )}
          <div className="plans-list">
            {listing.value.items.map((plan) => (
              <button
                type="button"
                disabled={pendingRequest}
                className={`plans-row ${selected === plan.id ? 'selected' : ''}`}
                key={plan.id}
                onClick={() => {
                  location.hash = new URLSearchParams({ tenant, view: 'plans', plan: plan.id }).toString();
                  setSelected(plan.id);
                }}
              >
                <div>
                  <strong>{plan.configuration.goal}</strong>
                  <span>
                    {context.value!.workspaces.find((w) => w.id === plan.configuration.workspaceId)?.name ??
                      '当前获权空间'}{' '}
                    · {behavior(plan.configuration.behavior)}
                  </span>
                </div>
                <div>
                  <Badge>{statusLabels[plan.status]}</Badge>
                  <span>
                    {plan.status === 'ACTIVE' ? runtimeLabels[plan.runtimeState] : `已运行 ${plan.runs} 次`}
                  </span>
                </div>
              </button>
            ))}
          </div>
          <Pager page={page} next={listing.value.hasMore} onPage={setPage} />
          {selected && (
            <PlanCard
              key={tenant + selected}
              tenant={tenant}
              owner={owner}
              id={selected}
              refresh={refresh}
              onChanged={changed}
              close={() => {
                setSelected(null);
                location.hash = '#' + new URLSearchParams({ tenant, view: 'plans' });
              }}
            />
          )}
        </>
      )}
      {editing && context.value && (
        <PlanEditor
          key={editing === 'new' ? 'new' : editing.id + editing.revision}
          tenant={tenant}
          owner={owner}
          current={editing === 'new' ? undefined : editing}
          spaces={context.value.workspaces}
          close={() => setEditing(null)}
          saved={(plan) => {
            setEditing(null);
            setSelected(plan.id);
            changed();
          }}
        />
      )}
    </section>
  );
}
function PlanDetails({
  tenant,
  owner,
  id,
  refresh,
  onChanged,
  onEdit,
}: {
  tenant: string;
  owner: string;
  id: string;
  refresh: number;
  onChanged: () => void;
  onEdit: (p: Plan) => void;
}) {
  const [action, setAction] = useState<PlanAction | null>(null),
    [page, setPage] = useState(0);
  const [version, setVersion] = useState<number | null>(null);
  const { session } = useSession();
  const value = useRemote(
    (signal) => api.get(tenant, owner, id, signal),
    [tenant, owner, id, refresh, session.identity],
  );
  const runs = useRemote(
    (signal) => api.runs(tenant, id, page * 20, signal),
    [tenant, id, page, refresh, session.identity],
  );
  if (value.error) return <Failure error={value.error} retry={onChanged} />;
  if (!value.value) return <Loading />;
  const plan = value.value,
    config = plan.configuration;
  return (
    <article className="plans-detail" aria-label="计划详情">
      <h3>{config.goal}</h3>
      <p>{config.purpose}</p>
      <p className="plans-query">{config.query}</p>
      <p>
        <Badge>{statusLabels[plan.status]}</Badge> ·{' '}
        {config.dailyTime ? `每天 ${config.dailyTime}` : '资料更新时'} ·{' '}
        {config.dailyTime ? date(plan.nextDue, config.timeZone) : '等待资料变化'}
      </p>
      <details>
        <summary>配置与资源范围</summary>
        <dl className="plans-facts">
          <div>
            <dt>执行范围</dt>
            <dd>以本人当前权限，{behavior(config.behavior)}；结果仅本人接收，不发布到共享空间或外部。</dd>
          </div>
          <div>
            <dt>触发条件</dt>
            <dd>
              {config.materialEvents ? '资料新版本就绪后检查' : ''}
              {config.materialEvents && config.dailyTime ? '；' : ''}
              {config.dailyTime ? `每天 ${config.dailyTime}（${config.timeZone}）` : ''}
            </dd>
          </div>
          <div>
            <dt>资源与退出</dt>
            <dd>
              最短间隔 {config.minIntervalSeconds / 60} 分钟；每日最多 {config.maxRunsPerDay} 次，总计最多{' '}
              {config.maxTotalRuns} 次。{date(config.expiresAt, config.timeZone)} 到期停止。
            </dd>
          </div>
          <div>
            <dt>真实状态</dt>
            <dd>
              {statusLabels[plan.status]} · {runtimeLabels[plan.runtimeState]}。
              {plan.reason ? (reasonLabels[plan.reason] ?? plan.reason) : ''}
            </dd>
          </div>
          <div>
            <dt>本次用量</dt>
            <dd>
              今日 {plan.todayRuns} 次，累计 {plan.runs} 次。次数上限不代表模型费用封顶。
            </dd>
          </div>
          <div>
            <dt>后续核查</dt>
            <dd>
              {config.dailyTime ? date(plan.nextDue, config.timeZone) : '等待资料版本变化'}；一般提醒
              {config.notificationsEnabled ? '开启' : '关闭'}。
            </dd>
          </div>
        </dl>
      </details>
      <div className="plans-actions">
        {plan.status === 'DRAFT' && (
          <Button variant="primary" onClick={() => setAction('ENABLE')}>
            查看委托并启用
          </Button>
        )}
        {['PAUSED', 'AUTHORIZATION_REQUIRED'].includes(plan.status) && (
          <Button variant="primary" onClick={() => setAction('RESUME')}>
            核对并恢复计划
          </Button>
        )}
        {plan.status === 'ACTIVE' && <Button onClick={() => setAction('PAUSE')}>暂停计划</Button>}
        {plan.status === 'ACTIVE' &&
          plan.runtimeState === 'NEEDS_ATTENTION' &&
          plan.reason === 'TASK_NEEDS_ATTENTION' &&
          ['FAILED', 'CANCELLED', 'INTERRUPTED'].includes(runs.value?.items[0]?.status ?? '') && (
            <Button onClick={() => setAction('RETRY')}>重新检查当前资料</Button>
          )}
        {['DRAFT', 'PAUSED', 'AUTHORIZATION_REQUIRED'].includes(plan.status) && (
          <Button onClick={() => onEdit(plan)}>修改委托</Button>
        )}
        {!['STOPPED', 'EXPIRED'].includes(plan.status) && (
          <>
            <Button onClick={() => setAction(config.notificationsEnabled ? 'MUTE' : 'UNMUTE')}>
              {config.notificationsEnabled ? '关闭提醒' : '开启提醒'}
            </Button>
            <Button variant="danger" onClick={() => setAction('STOP')}>
              停止计划
            </Button>
          </>
        )}
      </div>
      <details>
        <summary>运行记录与历史版本</summary>
        <p className="muted">
          每条记录对应真实任务。触发时的资料版本不等于模型实际引用范围；缺口与实际依据在原任务中核对。
        </p>
        {runs.error ? (
          <Failure error={runs.error} retry={onChanged} />
        ) : !runs.value ? (
          <Loading />
        ) : (
          <>
            {!runs.value.items.length && <p>尚未启动任务。等待资料、模型或触发时间不会生成成果记录。</p>}
            <ol className="plans-runs">
              {runs.value.items.map((run) => (
                <li key={run.id}>
                  <div>
                    <strong>
                      {run.triggerKind === 'DAILY'
                        ? '每日核查'
                        : run.triggerKind === 'RETRY'
                          ? '明确重试'
                          : '资料变化'}
                    </strong>
                    <Badge>
                      {(
                        {
                          QUEUED: '已排队',
                          RUNNING: '执行中',
                          SUCCEEDED: '检查完成',
                          FAILED: '执行失败',
                          INTERRUPTED: '已中断',
                          CANCELLED: '已取消',
                          WAITING_INPUT: '等待补充',
                          WAITING_CAPABILITY: '等待能力',
                          PAUSED: '本次已暂停',
                          PARTIAL: '部分完成',
                          RESULT_UNKNOWN: '结果待核对',
                        } as Record<string, string>
                      )[run.status] ?? run.status}
                    </Badge>
                  </div>
                  <p>
                    {date(run.createdAt, config.timeZone)} · 依据覆盖 {run.sourceVersions.length} 个资料版本 ·
                    委托版本 {run.planRevision}
                  </p>
                  {run.missedSlots > 0 && (
                    <p>中断期间错过 {run.missedSlots} 次约定检查，本次仅核查当前情况。</p>
                  )}
                  <a
                    href={`/workspace/#tenant=${tenant}&view=conversations&conversation=${run.conversationId}&task=${run.taskId}`}
                  >
                    查看原任务
                  </a>
                  <Button variant="ghost" onClick={() => setVersion(run.planRevision)}>
                    查看委托版本
                  </Button>
                </li>
              ))}
            </ol>
            <Pager page={page} next={runs.value.hasMore} onPage={setPage} />
          </>
        )}
      </details>
      {action && (
        <PlanActionDialog
          plan={plan}
          action={action}
          close={() => setAction(null)}
          done={() => {
            setAction(null);
            onChanged();
          }}
        />
      )}
      {version !== null && (
        <PlanVersionDialog tenant={tenant} id={id} revision={version} close={() => setVersion(null)} />
      )}
    </article>
  );
}
function PlanVersionDialog({
  tenant,
  id,
  revision,
  close,
}: {
  tenant: string;
  id: string;
  revision: number;
  close: () => void;
}) {
  const { session } = useSession();
  const [attempt, setAttempt] = useState(0);
  const value = useRemote(
    (signal) => api.version(tenant, id, revision, signal),
    [tenant, id, revision, attempt, session.identity],
  );
  return (
    <Modal title={`委托版本 ${revision}`} onClose={close}>
      {value.error ? (
        <Failure error={value.error} retry={() => setAttempt((x) => x + 1)} />
      ) : !value.value ? (
        <Loading />
      ) : (
        <>
          <h3>{value.value.configuration.goal}</h3>
          <p>{value.value.configuration.purpose}</p>
          <p className="plans-query">{value.value.configuration.query}</p>
          <p>
            {behavior(value.value.configuration.behavior)}；每日最多 {value.value.configuration.maxRunsPerDay}{' '}
            次，累计最多 {value.value.configuration.maxTotalRuns} 次。
            {date(value.value.configuration.expiresAt, value.value.configuration.timeZone)} 结束。
          </p>
          <p className="muted">这是当时已接受的委托快照。查看历史不会恢复旧授权或重新运行。</p>
        </>
      )}
    </Modal>
  );
}
function PlanActionDialog({
  plan,
  action,
  close,
  done,
}: {
  plan: Plan;
  action: PlanAction;
  close: () => void;
  done: () => void;
}) {
  const submission = useSubmission<{ revision: number; action: PlanAction; accepted: boolean }>(),
    [accepted, setAccepted] = useState(false);
  const enable = ['ENABLE', 'RESUME', 'RETRY'].includes(action),
    c = plan.configuration;
  useRequestLock(submission.busy || submission.uncertain);
  const title = {
    ENABLE: '启用持续委托',
    RESUME: '恢复持续委托',
    RETRY: '重新检查当前资料',
    PAUSE: '暂停计划',
    STOP: '停止计划',
    MUTE: '关闭一般提醒',
    UNMUTE: '开启一般提醒',
  }[action];
  return (
    <Modal
      title={title}
      onClose={() => {
        if (!submission.busy && !submission.uncertain) close();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submission.submit(
            { revision: plan.revision, action, accepted: enable ? accepted : false },
            async (body, requestId) => {
              await api.action(plan.tenantId, plan.ownerId, plan.id, {
                requestId,
                expectedRevision: body.revision,
                action: body.action,
                delegationAccepted: body.accepted,
              });
              done();
            },
          );
        }}
      >
        {enable ? (
          <>
            <p>
              在当前所选空间，以我的权限持续{behavior(c.behavior)}，用途为「{c.purpose}
              」。只交付给本人，不代其他成员运行。
            </p>
            <p>
              {c.dailyTime ? `每日 ${c.dailyTime}（${c.timeZone}）核查；` : ''}
              {c.materialEvents ? '资料版本变化后检查；' : ''}每日最多 {c.maxRunsPerDay} 次、累计最多{' '}
              {c.maxTotalRuns} 次，于 {date(c.expiresAt, c.timeZone)} 结束。可随时暂停或停止。
            </p>
            <p className="muted">
              恢复只核查当前条件，不复活旧尝试，也不补做所有过去日期。AI
              分析在模型未连接时等待，次数不等于费用承诺。
            </p>
            <label className="plans-check">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                disabled={submission.busy || submission.uncertain}
              />
              我确认以上范围、用途、行为、次数与结束条件
            </label>
          </>
        ) : (
          <p>
            {action === 'MUTE' || action === 'UNMUTE'
              ? '这只改变一般提醒偏好，持续检查仍按原委托运行。'
              : '将停止本计划后续启动，并中断尚未结束的关联检查。已经产生的结果保留真实记录；停止后的计划不自动恢复。'}
          </p>
        )}
        <SubmitError error={submission.error} uncertain={submission.uncertain} />
        <FormActions>
          <Button onClick={close} disabled={submission.busy || submission.uncertain}>
            返回
          </Button>
          <Button
            type="submit"
            variant={action === 'STOP' ? 'danger' : 'primary'}
            disabled={submission.busy || (enable && !accepted)}
          >
            {submission.uncertain ? '重试相同请求' : submission.busy ? '正在保存…' : title}
          </Button>
        </FormActions>
      </form>
    </Modal>
  );
}
function PlanEditor({
  tenant,
  owner,
  current,
  spaces,
  close,
  saved,
}: {
  tenant: string;
  owner: string;
  current?: Plan;
  spaces: { id: string; name: string; kind: string }[];
  close: () => void;
  saved: (p: Plan) => void;
}) {
  const [config, setConfig] = useState<PlanConfiguration>(
    current?.configuration ?? {
      workspaceId: spaces.find((s) => s.kind === 'PERSONAL')?.id ?? spaces[0]?.id ?? '',
      goal: '',
      purpose: '',
      query: '',
      behavior: 'SOURCE_LOOKUP',
      materialEvents: true,
      dailyTime: null,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
      minIntervalSeconds: 3600,
      maxRunsPerDay: 4,
      maxTotalRuns: 30,
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      notificationsEnabled: true,
    },
  );
  const submission = useSubmission<PlanConfiguration>(),
    disabled = submission.busy || submission.uncertain;
  useRequestLock(disabled);
  const set = <K extends keyof PlanConfiguration>(key: K, value: PlanConfiguration[K]) =>
    setConfig((c) => ({ ...c, [key]: value }));
  return (
    <Modal
      title={current ? '修改持续委托' : '新建持续计划'}
      onClose={() => {
        if (!disabled) close();
      }}
    >
      <form
        className="plans-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submission.submit(config, async (body, requestId) =>
            saved(
              current
                ? await api.update(tenant, owner, current.id, {
                    requestId,
                    expectedRevision: current.revision,
                    configuration: body,
                  })
                : await api.create(tenant, owner, { requestId, configuration: body }),
            ),
          );
        }}
      >
        <p className="muted">先保存完整委托，再明确启用。只在你当前可访问的一个空间中运行。</p>
        <fieldset disabled={disabled}>
          <Field label="持续目标">
            <input
              aria-label="持续目标"
              required
              maxLength={160}
              value={config.goal}
              onChange={(e) => set('goal', e.target.value)}
              placeholder="例如：关注项目进度依据"
            />
          </Field>
          <Field label="用途与边界">
            <textarea
              aria-label="用途与边界"
              required
              maxLength={1000}
              value={config.purpose}
              onChange={(e) => set('purpose', e.target.value)}
              placeholder="例如：帮助本人检查进度，仅提供依据，不对团队发布"
            />
          </Field>
          <Field label="资料范围">
            <select
              aria-label="资料范围"
              value={config.workspaceId}
              onChange={(e) => set('workspaceId', e.target.value)}
            >
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.kind === 'PERSONAL' ? '（本人私人空间）' : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="执行行为">
            <select
              aria-label="执行行为"
              value={config.behavior}
              onChange={(e) => set('behavior', e.target.value as PlanConfiguration['behavior'])}
            >
              <option value="SOURCE_LOOKUP">检索资料依据（无需模型）</option>
              <option value="ANALYZE">AI 分析建议（模型未接时等待）</option>
            </select>
          </Field>
          <Field label={config.behavior === 'SOURCE_LOOKUP' ? '检索关键词' : '分析要求'}>
            <textarea
              aria-label="检查内容"
              required
              maxLength={config.behavior === 'SOURCE_LOOKUP' ? 200 : 2000}
              value={config.query}
              onChange={(e) => set('query', e.target.value)}
            />
          </Field>
          <label className="plans-check">
            <input
              type="checkbox"
              checked={config.materialEvents}
              onChange={(e) => set('materialEvents', e.target.checked)}
            />
            资料出现新版本时检查
          </label>
          <label className="plans-check">
            <input
              type="checkbox"
              checked={config.dailyTime !== null}
              onChange={(e) => set('dailyTime', e.target.checked ? '09:00' : null)}
            />
            每天约定时间核查
          </label>
          {config.dailyTime !== null && (
            <Field label="每日核查时间">
              <input
                aria-label="每日核查时间"
                type="time"
                required
                value={config.dailyTime}
                onChange={(e) => set('dailyTime', e.target.value)}
              />
            </Field>
          )}
          <Field label="适用时区" hint="夏令时跳过的时刻顺延到首个有效时刻，重复的时刻只执行较早一次。">
            <input
              aria-label="适用时区"
              required
              value={config.timeZone}
              onChange={(e) => set('timeZone', e.target.value)}
            />
          </Field>
          <div className="plans-grid">
            <Field label="最短间隔（分钟）">
              <input
                aria-label="最短间隔（分钟）"
                type="number"
                min={1}
                max={1440}
                required
                value={config.minIntervalSeconds / 60}
                onChange={(e) => set('minIntervalSeconds', Number(e.target.value) * 60)}
              />
            </Field>
            <Field label="每日最多次数">
              <input
                aria-label="每日最多次数"
                type="number"
                min={1}
                max={24}
                required
                value={config.maxRunsPerDay}
                onChange={(e) => set('maxRunsPerDay', Number(e.target.value))}
              />
            </Field>
            <Field label="总运行次数">
              <input
                aria-label="总运行次数"
                type="number"
                min={1}
                max={10000}
                required
                value={config.maxTotalRuns}
                onChange={(e) => set('maxTotalRuns', Number(e.target.value))}
              />
            </Field>
          </div>
          <Field label="结束时间" hint="按当前设备时区填写；保存后显示适用时区中的确切结束时间。">
            <input
              aria-label="结束时间"
              type="datetime-local"
              required
              value={localInput(config.expiresAt)}
              onChange={(e) => {
                if (e.target.value) set('expiresAt', new Date(e.target.value).toISOString());
              }}
            />
          </Field>
        </fieldset>
        <p className="muted">
          本版每人最多 20 个未结束计划、每日 48 次计划任务、同时运行最多 2
          次。额度按次数限制，不是模型费用硬上限。到期资料或缺失权限不会因计划而恢复。
        </p>
        <SubmitError error={submission.error} uncertain={submission.uncertain} />
        <FormActions>
          <Button onClick={close} disabled={submission.busy || submission.uncertain}>
            返回
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={
              submission.busy || !spaces.length || (!config.materialEvents && config.dailyTime === null)
            }
          >
            {submission.uncertain ? '重试相同请求' : submission.busy ? '正在保存…' : '保存委托草案'}
          </Button>
        </FormActions>
      </form>
    </Modal>
  );
}

export function PlanCard({
  tenant,
  owner,
  id,
  close,
  onChanged = () => {},
  refresh = 0,
}: {
  tenant: string;
  owner: string;
  id: string;
  close: () => void;
  onChanged?: () => void;
  refresh?: number;
}) {
  const [attempt, setAttempt] = useState(0),
    [editing, setEditing] = useState<Plan | null>(null);
  const context = useRemote((signal) => identityClient.context(tenant, signal), [tenant]);
  const changed = () => {
    setAttempt((n) => n + 1);
    onChanged();
  };
  return (
    <>
      <Modal title="持续计划" wide className="live-library-deck-modal" onClose={close}>
        <LiveConversationDeck
          tenant={tenant}
          reader
          title="持续计划"
          onClose={close}
          onRefresh={changed}
          cards={[]}
        >
          <PlanDetails
            tenant={tenant}
            owner={owner}
            id={id}
            refresh={refresh + attempt}
            onChanged={changed}
            onEdit={setEditing}
          />
        </LiveConversationDeck>
      </Modal>
      {editing && context.value && (
        <PlanEditor
          tenant={tenant}
          owner={owner}
          current={editing}
          spaces={context.value.workspaces}
          close={() => setEditing(null)}
          saved={() => {
            setEditing(null);
            changed();
          }}
        />
      )}
    </>
  );
}

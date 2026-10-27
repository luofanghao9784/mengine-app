import { useMemo, useState } from 'react';
import { ChevronRight, Clock, Plus } from 'lucide-react';
import type { NativeConversation, NativeSchedule } from '../../contracts/public-api/native-conversations';
import { Button } from '../shared/ui';
import { useRemote } from '../shared/admin';
import { IdentityError } from '../identity/client';
import { planClient } from '../plans/client';
import { nativeConversationClient as api } from './client';
import { nativeHref } from './useNativeConversations';
import {
  describeRule,
  emptyForm,
  formProblems,
  fromConfig,
  resumable,
  runState,
  scheduleReason,
  scheduleState,
  toConfig,
  type RepeatKind,
  type ScheduleForm,
} from './schedules.ts';
import './native-conversation.css';

const message = (e: unknown) =>
  e instanceof IdentityError || e instanceof Error ? e.message : '操作未完成，请稍后重试。';
const when = new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const at = (iso: string | null) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? when.format(t) : '';
};
const zone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
  } catch {
    return 'Asia/Shanghai';
  }
};

/**
 * 定时：平台到点重新核对权限后，用这次会话的资料和附件开一个新的私人会话执行（附录 G）。
 * 每次执行都有记录；结果不明时平台会暂停且不会自动再跑。
 */
export function NativeSchedules({
  tenant,
  session,
  owner,
  schedules,
  refresh,
}: {
  tenant: string;
  session: NativeConversation;
  owner: string;
  schedules: { value?: NativeSchedule[]; error?: unknown };
  refresh: () => void;
}) {
  const [editing, setEditing] = useState<NativeSchedule | 'new' | null>(null);
  const active = session.state === 'ACTIVE';
  const list = schedules.value ?? [];
  return (
    <div className="native-schedules">
      {editing ? (
        <ScheduleEditor
          tenant={tenant}
          session={session.id}
          existing={editing === 'new' ? undefined : editing}
          onDone={() => {
            setEditing(null);
            refresh();
          }}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <>
          <section className="native-work-section">
            <h3>
              这个会话的定时任务
              {active && (
                <Button variant="ghost" icon={Plus} onClick={() => setEditing('new')}>
                  新建
                </Button>
              )}
            </h3>
            {schedules.error ? (
              <p className="native-error" role="alert">
                {message(schedules.error)}
              </p>
            ) : !schedules.value ? (
              <p className="native-muted">正在读取…</p>
            ) : !list.length ? (
              <p className="native-muted">
                还没有定时任务。可以让 AI 每天、每周或在资料更新时，按这个会话的资料和要求自动做一次。
              </p>
            ) : (
              <ul className="native-schedule-list">
                {list.map((s) => (
                  <ScheduleItem
                    key={s.id}
                    tenant={tenant}
                    session={session.id}
                    schedule={s}
                    onEdit={() => setEditing(s)}
                    onChanged={refresh}
                  />
                ))}
              </ul>
            )}
            {!active && <p className="native-muted">会话已停止，恢复后才能新建或恢复定时任务。</p>}
          </section>
          {active && (
            <LegacyPlans
              tenant={tenant}
              session={session}
              owner={owner}
              migrated={new Set(list.map((s) => s.legacy_plan_id).filter((x): x is string => !!x))}
              onMigrated={refresh}
            />
          )}
        </>
      )}
    </div>
  );
}

function ScheduleItem({
  tenant,
  session,
  schedule: s,
  onEdit,
  onChanged,
}: {
  tenant: string;
  session: string;
  schedule: NativeSchedule;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmStop, setConfirmStop] = useState(false);
  const set = async (state: 'ACTIVE' | 'PAUSED' | 'STOPPED') => {
    setBusy(true);
    setError('');
    try {
      await api.setSchedule(tenant, session, s.id, state);
      onChanged();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
      setConfirmStop(false);
    }
  };
  const live = s.state === 'ACTIVE' || s.state === 'PAUSED';
  return (
    <li className={`native-schedule is-${s.state.toLowerCase()}`}>
      <div className="native-schedule-head">
        <Clock size={15} aria-hidden="true" />
        <strong>{s.configuration.title}</strong>
        <span className={`native-row-state is-${s.state === 'ACTIVE' ? 'running' : 'muted'}`}>
          {scheduleState[s.state]}
        </span>
      </div>
      <p className="native-muted">
        {describeRule(s.configuration.rule, s.configuration.materialEvents)}
        {s.state === 'ACTIVE' && s.next_due ? ` · 下次 ${at(s.next_due)}` : ''}
        {s.legacy_plan_id ? ' · 由旧持续计划迁移' : ''}
      </p>
      {s.reason && <p className="native-schedule-reason">{scheduleReason[s.reason] ?? s.reason}</p>}
      {live && (
        <div className="native-actions">
          {s.state === 'ACTIVE' ? (
            <Button disabled={busy} onClick={() => set('PAUSED')}>
              暂停
            </Button>
          ) : (
            <>
              <Button
                variant="primary"
                disabled={busy || !resumable(s)}
                title={resumable(s) ? undefined : '这个定时任务不能直接恢复，原因见上方说明'}
                onClick={() => set('ACTIVE')}
              >
                恢复
              </Button>
              <Button disabled={busy || s.reason === 'OUTCOME_UNKNOWN'} onClick={onEdit}>
                编辑
              </Button>
            </>
          )}
          {confirmStop ? (
            <>
              <Button variant="danger" disabled={busy} onClick={() => set('STOPPED')}>
                确认停止
              </Button>
              <Button variant="ghost" onClick={() => setConfirmStop(false)}>
                取消
              </Button>
            </>
          ) : (
            <Button variant="ghost" disabled={busy} onClick={() => setConfirmStop(true)}>
              停止
            </Button>
          )}
        </div>
      )}
      {confirmStop && (
        <p className="native-muted">停止后不能再恢复，正在进行的执行会被取消；执行记录会保留。</p>
      )}
      {error && (
        <p className="native-error" role="alert">
          {error}
        </p>
      )}
      <Runs tenant={tenant} session={session} schedule={s.id} />
    </li>
  );
}

function Runs({ tenant, session, schedule }: { tenant: string; session: string; schedule: string }) {
  const [open, setOpen] = useState(false);
  const runs = useRemote(
    (signal) => (open ? api.scheduleRuns(tenant, session, schedule, signal) : Promise.resolve(null)),
    [tenant, session, schedule, open],
  );
  return (
    <details className="native-runs" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>
        <ChevronRight size={14} className="native-chevron" aria-hidden="true" />
        执行记录
      </summary>
      {runs.error ? (
        <p className="native-error" role="alert">
          {message(runs.error)}
        </p>
      ) : !runs.value ? (
        <p className="native-muted">正在读取…</p>
      ) : !runs.value.length ? (
        <p className="native-muted">还没有执行过。</p>
      ) : (
        <ul className="native-rows">
          {runs.value.map((r) => (
            <li key={r.id}>
              <span className="native-row-title">{at(r.created_at)}</span>
              <span
                className={`native-row-state is-${
                  r.state === 'SUCCEEDED'
                    ? 'done'
                    : ['FAILED', 'UNKNOWN', 'NEEDS_ATTENTION'].includes(r.state)
                      ? 'failed'
                      : r.state === 'CANCELLED'
                        ? 'muted'
                        : 'running'
                }`}
              >
                {runState[r.state]}
              </span>
              <a className="native-link" href={nativeHref(tenant, r.session_id)}>
                查看
              </a>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

const repeatOptions: [RepeatKind, string][] = [
  ['daily', '每天'],
  ['weekly', '每周'],
  ['once', '指定时间一次'],
  ['after', '延迟后一次'],
  ['every', '每隔一段时间'],
  ['material', '只在资料更新时'],
  ['cron', '自定义（cron）'],
];
const weekdays = ['一', '二', '三', '四', '五', '六', '日'];

function ScheduleEditor({
  tenant,
  session,
  existing,
  onDone,
  onCancel,
}: {
  tenant: string;
  session: string;
  existing?: NativeSchedule;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<ScheduleForm>(() =>
    existing
      ? fromConfig(existing.configuration, emptyForm(new Date(), zone()))
      : emptyForm(new Date(), zone()),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (change: Partial<ScheduleForm>) => setForm((f) => ({ ...f, ...change }));
  const config = toConfig(form);
  // The same configuration retried keeps its request id, so the platform replays instead of duplicating.
  const requestId = useMemo(() => crypto.randomUUID(), [JSON.stringify(config)]);
  const problems = formProblems(form);
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      if (existing) await api.editSchedule(tenant, session, existing.id, config);
      else await api.createSchedule(tenant, session, requestId, config);
      onDone();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const timed = form.repeat !== 'material';
  return (
    <form
      className="native-schedule-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!problems.length) void save();
      }}
    >
      <h3>{existing ? '编辑定时任务' : '新建定时任务'}</h3>
      <label className="field">
        <span>名称</span>
        <input
          value={form.title}
          maxLength={120}
          placeholder="例如：每天收款差异复核"
          onChange={(e) => set({ title: e.target.value })}
        />
      </label>
      <label className="field">
        <span>每次要 AI 做什么</span>
        <textarea
          rows={3}
          value={form.prompt}
          maxLength={10000}
          placeholder="例如：核对昨天五家店的收款，列出还没确认的几笔，整理成一份说明。"
          onChange={(e) => set({ prompt: e.target.value })}
        />
      </label>
      <label className="field">
        <span>什么时候运行</span>
        <select value={form.repeat} onChange={(e) => set({ repeat: e.target.value as RepeatKind })}>
          {repeatOptions.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {form.repeat === 'weekly' && (
        <div className="native-weekdays" role="group" aria-label="每周哪几天">
          {weekdays.map((d, i) => {
            const day = i + 1;
            const on = form.weekdays.includes(day);
            return (
              <Button
                key={day}
                aria-pressed={on}
                onClick={() =>
                  set({ weekdays: on ? form.weekdays.filter((x) => x !== day) : [...form.weekdays, day] })
                }
              >
                周{d}
              </Button>
            );
          })}
        </div>
      )}
      {form.repeat === 'once' && (
        <label className="field">
          <span>日期</span>
          <input type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} />
        </label>
      )}
      {['daily', 'weekly', 'once'].includes(form.repeat) && (
        <label className="field">
          <span>时间（{form.timeZone}）</span>
          <input type="time" value={form.time} onChange={(e) => set({ time: e.target.value })} />
        </label>
      )}
      {form.repeat === 'after' && (
        <label className="field">
          <span>延迟秒数（只运行一次）</span>
          <input
            type="number"
            min={1}
            step={1}
            value={form.afterSeconds}
            onChange={(e) => set({ afterSeconds: Number(e.target.value) })}
          />
        </label>
      )}
      {form.repeat === 'every' && (
        <label className="field">
          <span>每隔几小时</span>
          <input
            type="number"
            min={0.5}
            step={0.5}
            value={form.everyHours}
            onChange={(e) => set({ everyHours: Number(e.target.value) })}
          />
        </label>
      )}
      {form.repeat === 'cron' && (
        <label className="field">
          <span>cron 表达式（分 时 日 月 周，{form.timeZone}）</span>
          <input value={form.cron} onChange={(e) => set({ cron: e.target.value })} />
        </label>
      )}
      {timed && (
        <label className="native-check">
          <input
            type="checkbox"
            checked={form.materialEvents}
            onChange={(e) => set({ materialEvents: e.target.checked })}
          />
          所在空间的资料更新时也运行一次
        </label>
      )}
      <label className="field">
        <span>有效期到</span>
        <input type="date" value={form.expires} onChange={(e) => set({ expires: e.target.value })} />
      </label>
      <details className="native-limits">
        <summary>
          <ChevronRight size={14} className="native-chevron" aria-hidden="true" />
          次数限制：每天最多 {form.maxRunsPerDay} 次 · 总共最多 {form.maxTotalRuns} 次 · 两次至少隔{' '}
          {form.minIntervalMinutes} 分钟
        </summary>
        <div className="native-limits-body">
          <label className="field">
            <span>每天最多</span>
            <input
              type="number"
              min={1}
              max={24}
              value={form.maxRunsPerDay}
              onChange={(e) => set({ maxRunsPerDay: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            <span>总共最多</span>
            <input
              type="number"
              min={1}
              max={10000}
              value={form.maxTotalRuns}
              onChange={(e) => set({ maxTotalRuns: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            <span>两次至少隔（分钟）</span>
            <input
              type="number"
              min={1}
              max={1440}
              value={form.minIntervalMinutes}
              onChange={(e) => set({ minIntervalMinutes: Number(e.target.value) })}
            />
          </label>
        </div>
      </details>
      <p className="native-muted">
        每次执行都会用这个会话引用的资料和附件新开一个私人会话，结果和成果在执行记录里查看；发布仍需你确认。
      </p>
      {problems.length > 0 && <p className="native-muted">还差：{problems.join('、')}。</p>}
      {error && (
        <p className="native-error" role="alert">
          {error}
        </p>
      )}
      <div className="native-actions">
        <Button variant="primary" type="submit" disabled={busy || problems.length > 0}>
          {existing ? '保存' : '创建'}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          取消
        </Button>
      </div>
    </form>
  );
}

/** Old “持续计划” in this space can move here; the platform stops the old one in the same step. */
function LegacyPlans({
  tenant,
  session,
  owner,
  migrated,
  onMigrated,
}: {
  tenant: string;
  session: NativeConversation;
  owner: string;
  migrated: Set<string>;
  onMigrated: () => void;
}) {
  const plans = useRemote((signal) => planClient.list(tenant, owner, 0, signal), [tenant, owner]);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const movable = (plans.value?.items ?? []).filter(
    (p) =>
      p.configuration.workspaceId === session.workspaceId &&
      !migrated.has(p.id) &&
      !['STOPPED', 'EXPIRED', 'AUTHORIZATION_REQUIRED'].includes(p.status),
  );
  if (!movable.length) return null;
  return (
    <section className="native-work-section">
      <h3>可迁移的旧持续计划</h3>
      <ul className="native-rows">
        {movable.map((p) => (
          <li key={p.id} className="native-legacy-plan">
            <span className="native-row-title">{p.configuration.goal}</span>
            {confirm === p.id ? (
              <>
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError('');
                    try {
                      await api.migratePlan(tenant, session.id, p.id);
                      setConfirm(null);
                      onMigrated();
                    } catch (e) {
                      setError(message(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  确认迁移
                </Button>
                <Button variant="ghost" onClick={() => setConfirm(null)}>
                  取消
                </Button>
              </>
            ) : (
              <Button onClick={() => setConfirm(p.id)}>迁移到这里</Button>
            )}
          </li>
        ))}
      </ul>
      {confirm && (
        <p className="native-muted">迁移会保留规则、次数和资料更新进度，旧计划同时停用；历史记录不删除。</p>
      )}
      {error && (
        <p className="native-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

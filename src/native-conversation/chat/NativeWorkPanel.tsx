import {
  Check,
  Circle,
  CircleDot,
  Flag,
  GitBranch,
  ListTodo,
  Loader2,
  Users,
  Workflow,
  X,
} from 'lucide-react';
import type { Job, WorkState } from './work.ts';
import './native-chat.css';

const goalPhase = { active: '进行中', paused: '已暂停', blocked: '受阻', complete: '已完成' } as const;
const jobState: Record<Job['status'], string> = {
  running: '进行中',
  completed: '已完成',
  killed: '已停止',
  failed: '失败',
};
const minutes = (from: number, to: number) => {
  const m = Math.max(0, Math.round((to - from) / 60_000));
  return m < 1 ? '不到 1 分钟' : `${m} 分钟`;
};

/** 长任务进展：目标、待办、后台任务、子任务、工作流。只显示 DH 记录里有的，不估算进度或时间。 */
export function NativeWorkPanel({ work }: { work: WorkState }) {
  const done = work.todos.filter((t) => t.status === 'completed').length;
  return (
    <div className="native-work">
      {work.planMode && <p className="native-plan-chip">计划模式：先给出计划，经你审阅后再执行</p>}
      {work.goal && (
        <section className="native-work-section">
          <h3>
            <Flag size={14} aria-hidden="true" />
            持续目标
            <span className={`native-chip is-${work.goal.phase}`}>{goalPhase[work.goal.phase]}</span>
          </h3>
          <p className="native-goal">{work.goal.objective}</p>
          <p className="native-muted">
            已推进 {work.goal.rounds} 轮{work.goal.maxRounds ? `，最多 ${work.goal.maxRounds} 轮` : ''}
            {work.goal.blockedReason ? `；受阻原因：${work.goal.blockedReason}` : ''}
          </p>
        </section>
      )}
      {work.todos.length > 0 && (
        <section className="native-work-section">
          <h3>
            <ListTodo size={14} aria-hidden="true" />
            待办
            <span className="native-muted">
              {done}/{work.todos.length}
            </span>
          </h3>
          <ul className="native-todos">
            {work.todos.map((t, i) => (
              <li key={i} className={`is-${t.status}`}>
                {t.status === 'completed' ? (
                  <Check size={14} aria-label="已完成" />
                ) : t.status === 'in_progress' ? (
                  <CircleDot size={14} aria-label="进行中" />
                ) : (
                  <Circle size={14} aria-label="未开始" />
                )}
                <span>{t.content}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {work.jobs.length > 0 && (
        <section className="native-work-section">
          <h3>
            <GitBranch size={14} aria-hidden="true" />
            后台任务
          </h3>
          <ul className="native-rows">
            {work.jobs.map((j) => (
              <li key={j.id}>
                <span className="native-row-title">{j.label}</span>
                <span className={`native-chip is-${j.status}`}>
                  {j.status === 'running' && <Loader2 size={11} className="native-spin" aria-hidden="true" />}
                  {jobState[j.status]}
                </span>
                {j.finishedAt && (
                  <small className="native-muted">用时 {minutes(j.startedAt, j.finishedAt)}</small>
                )}
                {j.detail && <small className="native-muted">{j.detail}</small>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {work.subtasks.length > 0 && (
        <section className="native-work-section">
          <h3>
            <Users size={14} aria-hidden="true" />
            子任务
          </h3>
          <ul className="native-rows">
            {work.subtasks.map((s) => (
              <li key={s.id}>
                <span className="native-row-title">{s.label}</span>
                <small className="native-muted">{s.mode === 'continuable' ? '可继续对话' : '一次性'}</small>
              </li>
            ))}
          </ul>
          <p className="native-muted">子任务的实时进展与用量在平台接通后显示。</p>
        </section>
      )}
      {work.workflows.map((run) => (
        <section key={run.id} className="native-work-section">
          <h3>
            <Workflow size={14} aria-hidden="true" />
            {run.name}
            <span className={`native-chip is-${run.stop ?? 'running'}`}>
              {run.stop === 'completed'
                ? '已完成'
                : run.stop === 'cancelled'
                  ? '已取消'
                  : run.stop === 'error'
                    ? '出错'
                    : '进行中'}
            </span>
          </h3>
          <ul className="native-rows">
            {run.agents.map((a) => (
              <li key={a.seq}>
                <span className="native-row-title">
                  {a.phase ? `${a.phase} · ` : ''}
                  {a.label}
                </span>
                <span className={`native-chip is-${a.outcome ?? 'running'}`}>
                  {a.outcome === 'completed' ? (
                    <Check size={11} aria-hidden="true" />
                  ) : a.outcome ? (
                    <X size={11} aria-hidden="true" />
                  ) : (
                    <Loader2 size={11} className="native-spin" aria-hidden="true" />
                  )}
                  {a.outcome === 'completed'
                    ? '完成'
                    : a.outcome === 'failed'
                      ? '失败'
                      : a.outcome === 'cancelled'
                        ? '取消'
                        : '进行中'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** One-line summary for the status bar, so progress is visible without opening the panel. */
export function workSummary(work: WorkState) {
  const parts: string[] = [];
  if (work.todos.length)
    parts.push(`待办 ${work.todos.filter((t) => t.status === 'completed').length}/${work.todos.length}`);
  const running = work.jobs.filter((j) => j.status === 'running').length;
  if (running) parts.push(`后台 ${running} 个进行中`);
  if (work.goal && work.goal.phase !== 'complete') parts.push(`目标${goalPhase[work.goal.phase]}`);
  return parts.join(' · ');
}

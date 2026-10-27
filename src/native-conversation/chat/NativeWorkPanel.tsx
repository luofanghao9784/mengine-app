import { Check, Circle, CircleDot } from 'lucide-react';
import type { Job, WorkState } from './work.ts';
import './native-chat.css';

const goalPhase = { active: '进行中', paused: '已暂停', blocked: '受阻', complete: '已完成' } as const;
const minutes = (from: number, to: number) => {
  const m = Math.max(0, Math.round((to - from) / 60_000));
  return m < 1 ? '不到 1 分钟' : `${m} 分钟`;
};

type Row = { key: string; label: string; state: string; tone: 'running' | 'done' | 'failed' | 'muted' };
const jobRow = (j: Job): Row => ({
  key: `job:${j.id}`,
  label: j.label,
  state:
    j.status === 'running'
      ? '进行中'
      : j.status === 'completed'
        ? `完成${j.finishedAt ? ` · ${minutes(j.startedAt, j.finishedAt)}` : ''}`
        : j.status === 'killed'
          ? '已停止'
          : '失败',
  tone: j.status === 'running' ? 'running' : j.status === 'completed' ? 'done' : 'failed',
});

/**
 * 进展：目标、待办，以及“同时在做”的后台任务、子任务和工作流（对员工来说是同一类事）。
 * 只显示 DH 记录里有的，不估算进度或时间。
 */
export function NativeWorkPanel({ work }: { work: WorkState }) {
  const done = work.todos.filter((t) => t.status === 'completed').length;
  const rows: Row[] = [
    ...work.jobs.map(jobRow),
    ...work.subtasks.map((s) => ({
      key: `sub:${s.id}`,
      label: s.label,
      state: '子任务',
      tone: 'muted' as const,
    })),
    ...work.workflows.map((run): Row => {
      const finished = run.agents.filter((a) => a.outcome === 'completed').length;
      return {
        key: `flow:${run.id}`,
        label: run.name,
        state:
          run.stop === 'completed'
            ? '完成'
            : run.stop === 'cancelled'
              ? '已取消'
              : run.stop === 'error'
                ? '出错'
                : `已完成 ${finished} / ${run.agents.length} 步`,
        tone: run.stop === 'completed' ? 'done' : run.stop ? 'failed' : 'running',
      };
    }),
  ];
  return (
    <div className="native-work">
      {work.goal && (
        <section className="native-work-section">
          <h3>目标</h3>
          <p className="native-goal">{work.goal.objective}</p>
          <small className="native-muted">
            {goalPhase[work.goal.phase]} · 已推进 {work.goal.rounds} 轮
            {work.goal.maxRounds ? `，最多 ${work.goal.maxRounds} 轮` : ''}
            {work.goal.blockedReason ? ` · ${work.goal.blockedReason}` : ''}
          </small>
        </section>
      )}
      {work.todos.length > 0 && (
        <section className="native-work-section">
          <h3>
            待办
            <span>
              {done} / {work.todos.length}
            </span>
          </h3>
          <ul className="native-todos">
            {work.todos.map((t, i) => (
              <li key={i} className={`is-${t.status}`}>
                {t.status === 'completed' ? (
                  <Check size={15} aria-label="已完成" />
                ) : t.status === 'in_progress' ? (
                  <CircleDot size={15} aria-label="进行中" />
                ) : (
                  <Circle size={15} aria-label="未开始" />
                )}
                <span>{t.content}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {rows.length > 0 && (
        <section className="native-work-section">
          <h3>同时在做</h3>
          <ul className="native-rows">
            {rows.map((r) => (
              <li key={r.key}>
                <span className="native-row-title">{r.label}</span>
                <span className={`native-row-state is-${r.tone}`}>{r.state}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!work.goal && !work.todos.length && !rows.length && (
        <p className="native-empty">AI 开始长任务后，目标、待办和同时在做的事会显示在这里。</p>
      )}
    </div>
  );
}

/** Progress label for the tab: to-dos done out of total, when there are any. */
export function workCount(work: WorkState) {
  return work.todos.length
    ? `${work.todos.filter((t) => t.status === 'completed').length}/${work.todos.length}`
    : '';
}

import type { NativeEvent } from './events.ts';
import { buildTranscript } from './transcript.ts';
import { toolLabel } from './tools.ts';

/**
 * Long-task progress from the DH log (batch two of the alignment checklist): the agent's to-do
 * list, plan mode, goal, background jobs, sub-tasks and workflow runs. Shapes follow
 * `dsh-tool-todo`, `dsh-plan-mode`, `dsh-goal`, `dsh-jobs`, `dsh-subagent` and `dsh-tool-workflow`.
 * Only what the log records is shown; nothing here estimates progress or time.
 */
export type Todo = { content: string; status: 'pending' | 'in_progress' | 'completed' };
export type Goal = {
  objective: string;
  phase: 'active' | 'paused' | 'blocked' | 'complete';
  rounds: number;
  maxRounds: number;
  blockedReason?: string;
};
export type Job = {
  id: string;
  label: string;
  kind: string;
  startedAt: number;
  finishedAt?: number;
  status: 'running' | 'completed' | 'killed' | 'failed';
  detail?: string;
};
/**
 * A sub-task the agent delegated. Progress comes from the child session's own log (forwarded by the
 * platform with its session id) and the runtime's `subagent.finished` notice.
 */
export type Subtask = {
  id: string;
  label: string;
  mode: string;
  createdAt: number;
  state: 'running' | 'idle' | 'done' | 'failed';
  /** What it is doing now, while running. */
  current?: string;
  /** Tool steps taken so far. */
  steps: number;
  /** Its latest reply, or the output it finished with. */
  output?: string;
};
export type WorkflowRun = {
  id: string;
  name: string;
  agents: { seq: number; label: string; phase?: string; outcome?: 'completed' | 'failed' | 'cancelled' }[];
  stop?: 'completed' | 'cancelled' | 'error';
};
export type WorkState = {
  todos: Todo[];
  planMode: boolean;
  goal: Goal | null;
  jobs: Job[];
  subtasks: Subtask[];
  workflows: WorkflowRun[];
};

const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const todoStates = new Set(['pending', 'in_progress', 'completed']);
const goalPhases = new Set(['active', 'paused', 'blocked', 'complete']);
const jobStates = new Set(['completed', 'killed', 'failed']);

const text = (blocks: unknown) =>
  Array.isArray(blocks)
    ? blocks
        .filter(
          (b): b is { type: 'text'; text: string } =>
            record(b) && b.type === 'text' && typeof b.text === 'string',
        )
        .map((b) => b.text)
        .join('')
    : '';

/**
 * @param events the conversation's own events plus platform notices (no session id)
 * @param childEvents events of delegated sessions, each carrying its child session id
 */
export function buildWorkState(
  events: readonly NativeEvent[],
  childEvents: readonly NativeEvent[] = [],
): WorkState {
  let todos: Todo[] = [];
  let planMode = false;
  let goal: Goal | null = null;
  const jobs = new Map<string, Job>();
  const subtasks = new Map<string, Subtask>();
  const workflows = new Map<string, WorkflowRun>();
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    const d = event.data;
    if (!record(d)) continue;
    switch (event.type) {
      case 'todo/write':
        if (Array.isArray(d.todos))
          todos = d.todos.filter(
            (t): t is Todo => record(t) && typeof t.content === 'string' && todoStates.has(String(t.status)),
          );
        break;
      case 'plan/mode':
        planMode = d.active === true;
        break;
      case 'goal/change':
        if (d.operation === 'clear') goal = null;
        else if (record(d.goal) && goalPhases.has(String(d.goal.phase)))
          goal = {
            objective: str(d.goal.objective),
            phase: d.goal.phase as Goal['phase'],
            rounds: num(d.roundsStarted),
            maxRounds: num(d.goal.maxGoalRounds),
            blockedReason: record(d.goal.blockedReason)
              ? str(d.goal.blockedReason.code) || undefined
              : undefined,
          };
        break;
      case 'job/registered':
      case 'job/settled': {
        const id = str(d.jobId);
        if (!id) break;
        const prior = jobs.get(id);
        jobs.set(id, {
          id,
          label: str(d.label) || prior?.label || '后台任务',
          kind: str(d.kind) || prior?.kind || '',
          startedAt: num(d.startedAt) || prior?.startedAt || event.time,
          ...(event.type === 'job/settled'
            ? {
                finishedAt: num(d.finishedAt) || event.time,
                status: (jobStates.has(String(d.status)) ? d.status : 'failed') as Job['status'],
                detail: str(d.detail) || undefined,
              }
            : { status: prior?.status ?? 'running' }),
        });
        break;
      }
      case 'subagent/catalog': {
        const id = str(d.childId);
        if (id)
          subtasks.set(id, {
            ...(subtasks.get(id) ?? { state: 'running', steps: 0 }),
            id,
            label: str(d.label) || '子任务',
            mode: str(d.mode),
            createdAt: num(d.childCreatedAt) || event.time,
          });
        break;
      }
      case 'subagent.started': {
        const id = str(d.childSessionId);
        if (id && !subtasks.has(id))
          subtasks.set(id, {
            id,
            label: '子任务',
            mode: '',
            createdAt: event.time,
            state: 'running',
            steps: 0,
          });
        break;
      }
      case 'subagent.finished': {
        const task = subtasks.get(str(d.childSessionId));
        if (task) {
          task.state = d.status === 'ok' ? 'done' : 'failed';
          task.output = text(d.lastAssistantMessage) || task.output;
        }
        break;
      }
      case 'tool-workflow/run-start': {
        const id = str(d.runId);
        if (id) workflows.set(id, { id, name: str(d.name) || '工作流', agents: [] });
        break;
      }
      case 'tool-workflow/agent-start': {
        const run = workflows.get(str(d.runId));
        if (run)
          run.agents.push({
            seq: num(d.seq),
            label: str(d.label) || '步骤',
            phase: str(d.phase) || undefined,
          });
        break;
      }
      case 'tool-workflow/agent-end': {
        const agent = workflows.get(str(d.runId))?.agents.find((a) => a.seq === num(d.seq));
        if (agent && ['completed', 'failed', 'cancelled'].includes(String(d.outcome)))
          agent.outcome = d.outcome as 'completed' | 'failed' | 'cancelled';
        break;
      }
      case 'tool-workflow/run-end': {
        const run = workflows.get(str(d.runId));
        if (run && ['completed', 'cancelled', 'error'].includes(String(d.stopReason)))
          run.stop = d.stopReason as WorkflowRun['stop'];
        break;
      }
    }
  }
  for (const task of subtasks.values()) progress(task, childEvents);
  return {
    todos,
    planMode,
    goal,
    jobs: [...jobs.values()],
    subtasks: [...subtasks.values()],
    workflows: [...workflows.values()],
  };
}

/** Fills a sub-task's live state from its own session log; a finish notice already read wins. */
function progress(task: Subtask, childEvents: readonly NativeEvent[]) {
  const own = childEvents.filter((e) => e.sessionId === task.id);
  if (!own.length) return;
  const log = buildTranscript(own);
  const items = log.turns.flatMap((t) => t.items);
  task.steps = items.filter((i) => i.kind === 'tool').length;
  const reply = [...items].reverse().find((i) => i.kind === 'assistant' && i.text);
  if (reply?.kind === 'assistant') task.output = reply.text;
  if (task.state === 'done' || task.state === 'failed') return;
  // `session.status` is the runtime's whole-agent state for that session; otherwise the log decides.
  const status = [...own].reverse().find((e) => e.type === 'session.status');
  const running = status && record(status.data) ? status.data.status === 'running' : log.running;
  const tool = [...items].reverse().find((i) => i.kind === 'tool' && i.status === 'running');
  task.state = running ? 'running' : 'idle';
  task.current = running ? (tool?.kind === 'tool' ? `正在${toolLabel(tool.name)}…` : '正在处理…') : undefined;
}

/** True when there is any long-task progress worth a panel of its own. */
export const hasWork = (w: WorkState) =>
  w.todos.length > 0 ||
  w.planMode ||
  !!w.goal ||
  w.jobs.length > 0 ||
  w.subtasks.length > 0 ||
  w.workflows.length > 0;

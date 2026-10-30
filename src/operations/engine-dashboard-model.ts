import type {
  EngineTelemetry,
  TelemetryChannel,
  TelemetryChannelCode,
} from '../../contracts/public-api/engine-telemetry.ts';
import type { OperationsOverview } from '../../contracts/public-api/operations.ts';
import type { UsageDay } from '../../contracts/public-api/usage.ts';
import type { DataOperationCounts } from '../../contracts/public-api/data-operations.ts';
import { errorLabels } from './client.ts';

/** Pure view model for the platform engine dashboard; every number comes from a real read. */
export type Stage = 'in' | 'pr' | 'out';
export const channelInfo: Record<TelemetryChannelCode, { name: string; stage: Stage; desc: string }> = {
  COLLECTION: {
    name: '外部取数',
    stage: 'in',
    desc: '按已配置的频率，从企业接入的数据源读取数据并生成固定版本。',
  },
  KNOWLEDGE: {
    name: '资料解析',
    stage: 'in',
    desc: '把上传或同步的资料解析为可检索的内容，保留原件与版本。',
  },
  RETRIEVAL: { name: '资料检索', stage: 'in', desc: '为会话与画报任务查找当前账号有权读取的资料。' },
  TASK: { name: '会话与画报', stage: 'pr', desc: '执行员工发起的会话，以及系统主动生成的画报任务。' },
  COMPANY: { name: '企业信息分析', stage: 'pr', desc: '从企业资料中提炼企业信息，并记录推断依据。排队按资料片段计数，执行中按分析批次计数。' },
  SCENE_KNOWLEDGE: { name: '业务知识与星图', stage: 'pr', desc: '按企业处理数据底座的业务知识、资料知识和知识关联；状态来自实际执行记录。' },
  EXPERIENCE: { name: '经验提炼与核验', stage: 'pr', desc: '从任务与反馈中提炼经验，并由独立会话核验。' },
  GENERALIZATION: {
    name: '通用经验清洗',
    stage: 'pr',
    desc: '去除企业信息与隐私后，形成可在总库共享的通用经验。',
  },
  GENERAL_ADJUSTMENT: { name: '总库调整核验', stage: 'pr', desc: '核验总台对通用经验库提出的内容调整。' },
  RESPONSE: {
    name: '会话流式输出',
    stage: 'out',
    desc: '向员工逐段返回会话结果。流式输出期间只计入输出，避免与处理重复。',
  },
  EXPORT: { name: '成果导出', stage: 'out', desc: '把会话成果导出为文件，供下载或共享。' },
};
export const stageName: Record<Stage, string> = { in: '输入', pr: '处理', out: '输出' };
export const LANE_PARTICLES = 6;
export const ORBIT_PARTICLES = 10;
export const BEADS = 10;
/** One dot per actual running record, capped; no running record means no dot. */
export const particles = (running: number, cap = LANE_PARTICLES) => Number.isFinite(running) && Number.isFinite(cap)
  ? Math.floor(Math.min(Math.max(0, running), Math.max(0, cap)))
  : 0;
export const beads = (queued: number) => ({
  shown: Math.min(Math.max(0, queued), BEADS),
  more: Math.max(0, queued - BEADS),
});

export interface Totals {
  in: number;
  pr: number;
  out: number;
  r: number;
  q: number;
  w: number;
  u: number;
  f: number;
  d: number;
}
export function totals(t: EngineTelemetry): Totals {
  const v: Totals = { in: 0, pr: 0, out: 0, r: 0, q: 0, w: 0, u: 0, f: 0, d: 0 };
  for (const c of t.channels) {
    v[channelInfo[c.code].stage] += c.running;
    v.r += c.running;
    v.q += c.queued;
    v.w += c.waiting;
    v.u += c.unknown;
    v.f += c.failed;
    v.d += c.completedRecent;
  }
  return v;
}
/** One observed snapshot; ch keeps per-channel running/queued for the detail sparkline. */
export type Sample = Totals & { at: number; ch: Partial<Record<TelemetryChannelCode, [number, number]>> };
export const sample = (t: EngineTelemetry): Sample => ({
  ...totals(t),
  at: Date.parse(t.checkedAt),
  ch: Object.fromEntries(t.channels.map((c) => [c.code, [c.running, c.queued]])),
});
export const WINDOW_MS = 300_000;
/** Samples further apart than this are not joined; the page did not observe the gap. */
export const MAX_GAP_MS = 9_000;
export function addSample(old: Sample[], next: Sample) {
  return [...old.filter((s) => s.at < next.at && s.at >= next.at - WINDOW_MS), next];
}
export function runs<T extends { at: number }>(samples: T[]) {
  const out: T[][] = [];
  for (const s of samples) {
    const last = out.at(-1);
    if (last && s.at - last.at(-1)!.at <= MAX_GAP_MS) last.push(s);
    else out.push([s]);
  }
  return out;
}

export interface Attention {
  key: string;
  kind: 'error' | 'unknown' | 'queue';
  title: string;
  detail: string;
  n: number;
  at: string | null;
}
// Conversation task failures come from operations by error code; other channels only have telemetry counts.
const taskChannels = new Set<TelemetryChannelCode>(['RETRIEVAL', 'TASK', 'RESPONSE']);
export function attention(t: EngineTelemetry, ops: OperationsOverview | undefined): Attention[] {
  const items: Attention[] = [];
  for (const e of [...(ops?.errors || [])].sort(
    (a, b) => Date.parse(b.lastOccurredAt) - Date.parse(a.lastOccurredAt),
  ))
    items.push({
      key: `error:${e.code}`,
      kind: e.code === 'TASK_RESULT_UNKNOWN' ? 'unknown' : 'error',
      title: errorLabels[e.code],
      detail: '会话与画报任务 · 近 7 天创建且尚未恢复',
      n: e.tasks,
      at: e.lastOccurredAt,
    });
  for (const c of t.channels) {
    // When the detailed summary is unavailable, keep known task failures visible.
    if (ops && taskChannels.has(c.code)) continue;
    const name = channelInfo[c.code].name;
    if (c.failed > 0)
      items.push({
        key: `failed:${c.code}`,
        kind: 'error',
        title: `${name}有保留的失败或中断`,
        detail: '保留记录数，可能包含已重试的历史尝试',
        n: c.failed,
        at: null,
      });
    if (c.unknown > 0)
      items.push({
        key: `unknown:${c.code}`,
        kind: 'unknown',
        title: `${name}有结果待核对`,
        detail: '超时或断连后无法确认动作是否已发生，需核对原回执',
        n: c.unknown,
        at: null,
      });
  }
  for (const c of t.channels)
    if (c.queued >= BEADS)
      items.push({
        key: `queue:${c.code}`,
        kind: 'queue',
        title: `${channelInfo[c.code].name}排队较长`,
        detail: `排队达到 ${BEADS} 条及以上`,
        n: c.queued,
        at: null,
      });
  return items;
}

export interface WeekDay {
  date: string;
  label: string;
  requests: number;
  /** null = requests exist but tokens were not reported; never drawn as zero. */
  tokens: number | null;
  today: boolean;
}
export function week(days: UsageDay[]): WeekDay[] {
  const last = days.slice(-7);
  return last.map((d, i) => ({
    date: d.date,
    label:
      i === last.length - 1 ? '今天' : '周' + '日一二三四五六'[new Date(d.date + 'T00:00:00Z').getUTCDay()],
    requests: d.workRequests,
    tokens: d.inputTokens === null || d.outputTokens === null ? null : d.inputTokens + d.outputTokens,
    today: i === last.length - 1,
  }));
}

export const intakeSegments = (c: DataOperationCounts) =>
  [
    ['ready', '就绪', c.ready],
    ['processing', '处理中', c.processing],
    ['attention', '需处理', c.attention],
    ['not-started', '未开始', c.notStarted],
    ['stopped', '已停止', c.stopped],
  ] as const;

export interface Change {
  key: string;
  at: number;
  code: TelemetryChannelCode;
  text: string;
  delta: number;
  kind: 'up' | 'down' | 'alert';
}
/** Exact differences between two consecutive snapshots; no inferred cause. Newest first. */
export function changes(prev: EngineTelemetry, next: EngineTelemetry): Change[] {
  const at = Date.parse(next.checkedAt),
    before = new Map(prev.channels.map((c) => [c.code, c]));
  const out: Change[] = [];
  for (const c of next.channels) {
    const p = before.get(c.code);
    if (!p) continue;
    const add = (field: string, text: string, delta: number, kind: Change['kind']) =>
      out.push({ key: `${at}:${c.code}:${field}`, at, code: c.code, text, delta, kind });
    if (c.failed > p.failed) add('failed', '新增异常', c.failed - p.failed, 'alert');
    if (c.running !== p.running)
      add(
        'running',
        c.running > p.running ? '执行中增加' : '执行中减少',
        c.running - p.running,
        c.running > p.running ? 'up' : 'down',
      );
    if (c.queued !== p.queued)
      add('queued', c.queued > p.queued ? '排队增加' : '排队减少', c.queued - p.queued, 'down');
  }
  return out;
}

/** Completions observed between two snapshots: the window delta, at least one when the last completion moved. */
export function completions(prev: TelemetryChannel | undefined, next: TelemetryChannel) {
  if (!prev) return 0;
  const moved =
    next.lastCompletedAt !== null &&
    (prev.lastCompletedAt === null || Date.parse(next.lastCompletedAt) > Date.parse(prev.lastCompletedAt));
  return Math.max(next.completedRecent - prev.completedRecent, moved ? 1 : 0, 0);
}

import type {
  NativeSchedule,
  NativeScheduleConfig,
  NativeScheduleRule,
  NativeScheduleRun,
} from '../../contracts/public-api/native-conversations';

/** What the employee picks in the form; turned into a DH 0.2.1 rule by `toRule`. */
export type RepeatKind = 'daily' | 'weekly' | 'once' | 'after' | 'every' | 'material' | 'cron';
export type ScheduleForm = {
  title: string;
  prompt: string;
  repeat: RepeatKind;
  /** HH:mm for daily, weekly and once. */
  time: string;
  /** ISO weekdays, Monday 1 through Sunday 7. */
  weekdays: number[];
  /** YYYY-MM-DD for once. */
  date: string;
  everyHours: number;
  afterSeconds: number;
  /** Preserve exact seconds/offset when only non-time fields are edited. */
  originalAt?: {
    at: Extract<NativeScheduleRule, { kind: 'at' }>['at'];
    date: string;
    time: string;
    timeZone: string;
  };
  cron: string;
  timeZone: string;
  /** Also run when materials in the session's space change. */
  materialEvents: boolean;
  maxRunsPerDay: number;
  maxTotalRuns: number;
  minIntervalMinutes: number;
  /** YYYY-MM-DD, end of that local day. */
  expires: string;
};

const pad = (n: number) => String(n).padStart(2, '0');
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function emptyForm(now = new Date(), timeZone = 'Asia/Shanghai'): ScheduleForm {
  const tomorrow = new Date(now.getTime() + 86_400_000);
  const month = new Date(now.getTime() + 30 * 86_400_000);
  return {
    title: '',
    prompt: '',
    repeat: 'daily',
    time: '09:00',
    weekdays: [1],
    date: localDate(tomorrow),
    everyHours: 4,
    afterSeconds: 3600,
    cron: '0 9 * * 1-5',
    timeZone,
    materialEvents: false,
    maxRunsPerDay: 4,
    maxTotalRuns: 60,
    minIntervalMinutes: 30,
    expires: localDate(month),
  };
}

export function toRule(f: ScheduleForm): NativeScheduleRule | null {
  const time = `${f.time}:00`;
  switch (f.repeat) {
    case 'daily':
      return { kind: 'daily', daily: { time, time_zone: f.timeZone } };
    case 'weekly':
      return { kind: 'weekly', weekly: { time, time_zone: f.timeZone, weekdays: [...f.weekdays].sort() } };
    case 'once':
      if (
        f.originalAt &&
        f.date === f.originalAt.date &&
        f.time === f.originalAt.time &&
        f.timeZone === f.originalAt.timeZone
      )
        return { kind: 'at', at: f.originalAt.at };
      return { kind: 'at', at: { date: f.date, time, time_zone: f.timeZone } };
    case 'after':
      return { kind: 'after', afterSeconds: f.afterSeconds };
    case 'every':
      return { kind: 'every', everySeconds: Math.round(f.everyHours * 3600) };
    case 'cron':
      return { kind: 'cron', cron: { expression: f.cron.trim(), time_zone: f.timeZone } };
    case 'material':
      return null;
  }
}

function validDate(value: string): boolean {
  const date = new Date(`${value}T12:00:00`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date.getTime()) && localDate(date) === value;
}

/** Problems the employee can fix before sending; the platform still validates everything. */
export function formProblems(f: ScheduleForm): string[] {
  const problems: string[] = [];
  if (!f.title.trim()) problems.push('写一个名称');
  if (!f.prompt.trim()) problems.push('写下每次要 AI 做什么');
  if (!validDate(f.expires)) problems.push('填写有效的截止日期');
  if (f.repeat === 'once' && !validDate(f.date)) problems.push('填写有效的运行日期');
  if (['daily', 'weekly', 'once'].includes(f.repeat) && !/^([01]\d|2[0-3]):[0-5]\d$/.test(f.time))
    problems.push('填写有效的运行时间');
  if (f.repeat === 'after' && (!Number.isSafeInteger(f.afterSeconds) || f.afterSeconds < 1))
    problems.push('延迟至少 1 秒，使用整数');
  if (f.repeat === 'weekly' && !f.weekdays.length) problems.push('至少选一天');
  if (f.repeat === 'every' && !(f.everyHours >= 1 / 60)) problems.push('间隔至少 1 分钟');
  if (f.repeat === 'cron' && f.cron.trim().split(/\s+/).length !== 5) problems.push('cron 需要 5 段');
  if (!(f.minIntervalMinutes >= 1)) problems.push('两次之间至少隔 1 分钟');
  if (!(f.maxRunsPerDay >= 1 && f.maxRunsPerDay <= 24)) problems.push('每天次数在 1–24 之间');
  if (!(f.maxTotalRuns >= 1)) problems.push('总次数至少 1 次');
  return problems;
}

export function toConfig(f: ScheduleForm): NativeScheduleConfig {
  const rule = toRule(f);
  return {
    title: f.title.trim(),
    prompt: f.prompt.trim(),
    rule,
    materialEvents: f.repeat === 'material' || f.materialEvents,
    minIntervalSeconds: Math.round(f.minIntervalMinutes * 60),
    maxRunsPerDay: f.maxRunsPerDay,
    maxTotalRuns: f.maxTotalRuns,
    // End of the chosen local day.
    expiresAt: validDate(f.expires) ? new Date(`${f.expires}T23:59:59`).toISOString() : '',
  };
}

/** Back to the form, for editing a paused schedule. */
export function fromConfig(c: NativeScheduleConfig, fallback: ScheduleForm): ScheduleForm {
  const r = c.rule;
  const hm = (t: string) => t.slice(0, 5);
  const base = {
    ...fallback,
    title: c.title,
    prompt: c.prompt,
    materialEvents: c.materialEvents,
    maxRunsPerDay: c.maxRunsPerDay,
    maxTotalRuns: c.maxTotalRuns,
    minIntervalMinutes: Math.round(c.minIntervalSeconds / 60),
    expires: localDate(new Date(c.expiresAt)),
  };
  if (!r) return { ...base, repeat: 'material', materialEvents: true };
  switch (r.kind) {
    case 'daily':
      return { ...base, repeat: 'daily', time: hm(r.daily.time), timeZone: r.daily.time_zone };
    case 'weekly':
      return {
        ...base,
        repeat: 'weekly',
        time: hm(r.weekly.time),
        weekdays: r.weekly.weekdays,
        timeZone: r.weekly.time_zone,
      };
    case 'at': {
      let date: string,
        time: string,
        timeZone = fallback.timeZone;
      if (typeof r.at === 'string') {
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        }).formatToParts(new Date(r.at));
        const part = (name: string) => parts.find((p) => p.type === name)!.value;
        date = `${part('year')}-${part('month')}-${part('day')}`;
        time = `${part('hour')}:${part('minute')}`;
      } else {
        date = r.at.date;
        time = hm(r.at.time);
        timeZone = r.at.time_zone;
      }
      return {
        ...base,
        repeat: 'once',
        date,
        time,
        timeZone,
        originalAt: { at: r.at, date, time, timeZone },
      };
    }
    case 'every':
      return { ...base, repeat: 'every', everyHours: r.everySeconds / 3600 };
    case 'after':
      return { ...base, repeat: 'after', afterSeconds: r.afterSeconds };
    case 'cron':
      return { ...base, repeat: 'cron', cron: r.cron.expression, timeZone: r.cron.time_zone };
  }
}

const weekday = ['', '一', '二', '三', '四', '五', '六', '日'];
const hours = (seconds: number) =>
  seconds % 3600 === 0 ? `${seconds / 3600} 小时` : `${Math.round(seconds / 60)} 分钟`;

/** One line a person can read: “每周一、三 09:00”. */
export function describeRule(rule: NativeScheduleRule | null, materialEvents = false): string {
  const extra = materialEvents ? '，资料更新时也会运行' : '';
  if (!rule) return '资料更新时运行';
  switch (rule.kind) {
    case 'daily':
      return `每天 ${rule.daily.time.slice(0, 5)}${extra}`;
    case 'weekly':
      return `每周${rule.weekly.weekdays.map((d) => weekday[d]).join('、')} ${rule.weekly.time.slice(0, 5)}${extra}`;
    case 'at':
      return typeof rule.at === 'string'
        ? `${rule.at.slice(5, 10).replace('-', '月')}日 ${rule.at.slice(11, 16)} 一次${extra}`
        : `${Number(rule.at.date.slice(5, 7))}月${Number(rule.at.date.slice(8, 10))}日 ${rule.at.time.slice(0, 5)} 一次${extra}`;
    case 'every':
      return `每隔 ${hours(rule.everySeconds)}${extra}`;
    case 'after':
      return `${hours(rule.afterSeconds)}后一次${extra}`;
    case 'cron':
      return `按 cron「${rule.cron.expression}」${extra}`;
  }
}

export const scheduleState: Record<NativeSchedule['state'], string> = {
  ACTIVE: '进行中',
  PAUSED: '已暂停',
  STOPPED: '已停止',
  COMPLETED: '已完成',
};

/** Why a schedule paused itself; each says what the employee can do. */
export const scheduleReason: Record<string, string> = {
  AUTHORIZATION_REVOKED: '你对这个会话或资料的权限变了，已暂停。权限恢复后可以继续。',
  EXPIRED: '已过有效期。要继续请编辑有效期。',
  OUTCOME_UNKNOWN: '上次执行的结果没能确认，为免重复执行已暂停。请先看执行记录，确认后停用或新建。',
  TOTAL_RUN_LIMIT: '已达到总次数上限。',
  RUN_NEEDS_ATTENTION: '上次执行没有正常完成，已暂停。请看执行记录。',
  LEGACY_NEEDS_ATTENTION: '迁移前旧计划就需要处理，已暂停。',
  NATIVE_SCHEDULE_RULES_UNAVAILABLE: '定时规则暂时无法计算，请稍后再试。',
};

/** Pausing for an unknown outcome is final for that schedule; the platform will not resume it. */
export const resumable = (s: NativeSchedule) =>
  s.state === 'PAUSED' &&
  s.reason !== 'OUTCOME_UNKNOWN' &&
  Date.parse(s.configuration.expiresAt) > Date.now();

export const runState: Record<NativeScheduleRun['state'], string> = {
  READY: '等待执行',
  DISPATCHING: '正在派发',
  RUNNING: '运行中',
  SUCCEEDED: '完成',
  FAILED: '失败',
  UNKNOWN: '结果未确认',
  CANCELLED: '已取消',
  NEEDS_ATTENTION: '需要处理',
};

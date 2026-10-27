/**
 * The subset of DH 0.2.1 `SessionEvent` that the 梦擎 conversation page renders (see
 * docs/技术/DH原生会话前端对齐清单.md, appendix A). Events arrive verbatim from the platform;
 * every other type is kept in order but not shown. Shapes follow `@deepseek-ai/dsh-session`,
 * `dsh-llm`, `dsh-user-approval`, `dsh-tool-present` and `dsh-user-questions`.
 */
export type NativeEvent = {
  type: string;
  /** Platform cursor (appendix C): one order across the root, sub-tasks, interactions and status. */
  seq: number;
  time: number;
  data: unknown;
  /** DH session that produced the event; the root session's id is the conversation id. */
  sessionId?: string;
  ignorable?: true;
};

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'image'; attachment: unknown }
  | { type: 'file'; attachment: unknown }
  | { type: 'tool-call'; id: string; name: string; arguments: string }
  | { type: string };

export type MessageSource = { kind: string; callId?: string };
export type Message = {
  id: string;
  role: string;
  content: ContentBlock[];
  source: MessageSource;
  toolCallId?: string;
  isError?: boolean;
};

export type TurnEndReason =
  | { kind: 'completed' }
  | { kind: 'aborted'; reason?: unknown }
  | { kind: 'blocked' }
  | { kind: 'error'; error?: { message?: string; code?: string } }
  | { kind: string };

export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable';

export type QuestionOption = { label: string; description?: string };
export type QuestionItem = {
  id: string;
  question: string;
  detail?: string;
  header?: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
  intent?: { kind: 'plan-review'; approve: string; callId?: string };
};
export type QuestionAnswer = { id: string; selected: string[]; custom?: string };

export type PresentedFile = { path: string; description?: string };

const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown): v is number => Number.isSafeInteger(v);

/** Envelope check only; payloads are validated where they are read. Malformed entries are dropped. */
export function isNativeEvent(v: unknown): v is NativeEvent {
  return (
    record(v) && typeof v.type === 'string' && integer(v.seq) && typeof v.time === 'number' && 'data' in v
  );
}

/**
 * Reads one platform envelope. DH keeps millisecond times, platform notices use ISO strings; both
 * become milliseconds. Returns null for anything malformed.
 */
export function toNativeEvent(v: unknown): NativeEvent | null {
  if (!record(v) || typeof v.type !== 'string' || !integer(v.seq) || !('data' in v)) return null;
  const time = typeof v.time === 'number' ? v.time : typeof v.time === 'string' ? Date.parse(v.time) : NaN;
  if (!Number.isFinite(time)) return null;
  return {
    type: v.type,
    seq: v.seq,
    time,
    data: v.data,
    ...(typeof v.sessionId === 'string' ? { sessionId: v.sessionId } : {}),
    ...(v.ignorable === true ? { ignorable: true as const } : {}),
  };
}

/**
 * The conversation shows the root session only: sub-task events carry their own session id and
 * would otherwise mix their turns, to-dos and replies into the employee's conversation. Events
 * without a session id (sub-task start / finish notices) are platform-level and kept.
 */
export const isRootEvent = (event: NativeEvent, rootId: string) =>
  event.sessionId === undefined || event.sessionId === rootId;

export const ASK_USER_TOOL = 'ask_user_question';

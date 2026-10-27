import {
  ASK_USER_TOOL,
  type ApprovalOutcome,
  type ContentBlock,
  type Message,
  type NativeEvent,
  type PresentedFile,
  type QuestionItem,
  type TurnEndReason,
} from './events.ts';

export type ToolItem = {
  kind: 'tool';
  callId: string;
  name: string;
  arguments: string;
  status: 'running' | 'done' | 'error' | 'interrupted';
  result: string;
  error?: string;
};
export type Item =
  | {
      kind: 'assistant';
      key: string;
      /** Platform seq of the `assistant/message`, as the feedback endpoint expects (appendix C). */
      feedbackKey: string;
      text: string;
      reasoning: string;
      interrupted: boolean;
    }
  | ToolItem
  | {
      kind: 'approval';
      id: string;
      toolName: string;
      callId?: string;
      reason?: string;
      outcome?: ApprovalOutcome;
    }
  | {
      kind: 'question';
      callId: string;
      questions: QuestionItem[];
      answered: boolean;
      answer: string;
      /** The wait ended without an answer. Timed-out questions still accept a late answer. */
      closed?: 'timed-out' | 'cancelled';
      deadline?: number;
    }
  | { kind: 'deliverables'; callId: string; files: PresentedFile[] };
export type Turn = {
  turn: number;
  startedAt: number;
  endedAt?: number;
  end?: TurnEndReason;
  prompts: { id: string; text: string; attachments: number; references: number }[];
  items: Item[];
};
export type Transcript = {
  title?: string;
  turns: Turn[];
  /** A turn opened in the log and not yet closed: a fact from the log, not a guess. */
  running: boolean;
  /** Waiting on the employee: the conversation list marks these sessions. */
  pending: { approvals: number; questions: number; planReview: boolean };
  maintenance: 'compacting' | 'retrying' | null;
  lastSeq: number;
};

const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const blocks = (m: unknown): ContentBlock[] =>
  record(m) && Array.isArray(m.content) ? (m.content.filter(record) as ContentBlock[]) : [];
const textOf = (content: ContentBlock[], type: 'text' | 'reasoning') =>
  content
    .filter(
      (b): b is { type: typeof type; text: string } =>
        b.type === type && typeof (b as { text?: unknown }).text === 'string',
    )
    .map((b) => b.text)
    .join('');
const parseQuestions = (args: string): QuestionItem[] => {
  try {
    const value = JSON.parse(args) as unknown;
    if (!record(value) || !Array.isArray(value.questions)) return [];
    return value.questions.filter(
      (q): q is QuestionItem => record(q) && typeof q.id === 'string' && typeof q.question === 'string',
    );
  } catch {
    return [];
  }
};

/** The platform appends referenced materials to the prompt for the runtime; the employee did not type it. */
const REFERENCE_MARK = '\n\n用户引用的企业资料（';
const splitReferences = (text: string) => {
  const at = text.indexOf(REFERENCE_MARK);
  if (at < 0) return { text, references: 0 };
  const references = text
    .slice(at)
    .split('\n')
    .filter((line) => line.startsWith('{')).length;
  return { text: text.slice(0, at), references };
};

/**
 * Builds what the page shows from the DH event log, in log order. Unknown or malformed events are
 * skipped; nothing here invents progress, timing or state that the log does not record.
 */
export function buildTranscript(events: readonly NativeEvent[]): Transcript {
  const turns: Turn[] = [];
  const tools = new Map<string, ToolItem>();
  const questions = new Map<string, Extract<Item, { kind: 'question' }>>();
  const approvals = new Map<string, Extract<Item, { kind: 'approval' }>>();
  let title: string | undefined;
  let open: Turn | undefined;
  let compacting = false;
  let retrying = false;
  let lastSeq = 0;
  const current = (time: number) => {
    if (!open) {
      // Content before any turn/start (for example a restored head) still belongs somewhere visible.
      open = { turn: turns.length, startedAt: time, prompts: [], items: [] };
      turns.push(open);
    }
    return open;
  };
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    if (event.seq <= lastSeq) continue;
    lastSeq = event.seq;
    const data = event.data;
    if (!record(data)) continue;
    switch (event.type) {
      case 'turn/start':
        open = { turn: Number(data.turn), startedAt: event.time, prompts: [], items: [] };
        turns.push(open);
        retrying = false;
        break;
      case 'turn/end':
        if (open) {
          open.endedAt = event.time;
          open.end = record(data.reason) ? (data.reason as TurnEndReason) : { kind: 'completed' };
        }
        open = undefined;
        retrying = false;
        break;
      case 'user/message': {
        const source = record(data.source) ? data.source : {};
        if (source.kind === 'user-question-reply') {
          // A late answer to a timed-out question arrives as its own message.
          const question = questions.get(str(source.callId));
          if (question) {
            question.answered = true;
            question.closed = undefined;
            question.answer = textOf(blocks(data), 'text');
          }
          break;
        }
        if (source.kind !== 'user') break; // injected context and skills: not typed by the employee
        const content = blocks(data);
        current(event.time).prompts.push({
          id: str(data.id) || `seq:${event.seq}`,
          ...splitReferences(textOf(content, 'text')),
          attachments: content.filter((b) => b.type === 'image' || b.type === 'file').length,
        });
        break;
      }
      case 'assistant/message': {
        const content = blocks(data.message);
        const text = textOf(content, 'text');
        const reasoning = textOf(content, 'reasoning');
        if (text || reasoning)
          current(event.time).items.push({
            kind: 'assistant',
            key: `${data.turn}:${data.step}:${event.seq}`,
            feedbackKey: String(event.seq),
            text,
            reasoning,
            interrupted: data.interrupted === true,
          });
        retrying = false;
        break;
      }
      case 'tool/call': {
        const callId = str(data.callId);
        const name = str(data.name);
        const args = str(data.arguments);
        if (!callId) break;
        if (name === ASK_USER_TOOL) {
          const prior = questions.get(callId);
          if (prior) {
            if (!prior.questions.length) prior.questions = parseQuestions(args);
            break;
          }
          const item = {
            kind: 'question' as const,
            callId,
            questions: parseQuestions(args),
            answered: false,
            answer: '',
          };
          questions.set(callId, item);
          current(event.time).items.push(item);
        } else {
          const item: ToolItem = {
            kind: 'tool',
            callId,
            name,
            arguments: args,
            status: 'running',
            result: '',
          };
          tools.set(callId, item);
          current(event.time).items.push(item);
        }
        break;
      }
      case 'tool/result': {
        const message = (record(data.message) ? data.message : {}) as Partial<Message>;
        const callId = str(message.toolCallId);
        const text = textOf(blocks(message), 'text');
        const failure = record(data.error)
          ? str(data.error.reason) || str(data.error.code) || '执行失败'
          : '';
        const question = questions.get(callId);
        if (question) {
          // A timed-out wait also ends the tool call; only a real answer marks the question answered.
          let result: unknown;
          try { result = JSON.parse(text); } catch { /* older tool results may be plain text */ }
          if (record(result) && result.pending === true && result.callId === callId) {
            question.answered = false;
            question.closed = 'timed-out';
            question.deadline = undefined;
          } else if (!question.closed || (record(result) && Array.isArray(result.answers))) {
            question.answered = !failure && !message.isError;
            question.answer = text;
          }
          break;
        }
        const tool = tools.get(callId);
        if (!tool) break;
        tool.result = text;
        tool.status = failure || message.isError ? 'error' : 'done';
        if (failure) tool.error = failure;
        break;
      }
      // Platform notices for `ask_user_question` (appendix C); the tool call itself may come first or later.
      case 'question/asked': {
        const callId = str(data.callId);
        if (!callId) break;
        const items = Array.isArray(data.questions)
          ? data.questions.filter(
              (q): q is QuestionItem =>
                record(q) && typeof q.id === 'string' && typeof q.question === 'string',
            )
          : [];
        const prior = questions.get(callId);
        if (prior) {
          if (items.length) prior.questions = items;
          break;
        }
        const item = { kind: 'question' as const, callId, questions: items, answered: false, answer: '' };
        questions.set(callId, item);
        current(event.time).items.push(item);
        break;
      }
      case 'question/deadline': {
        const question = questions.get(str(data.callId));
        const deadline = typeof data.deadline === 'string' ? Date.parse(data.deadline) : NaN;
        if (question && Number.isFinite(deadline)) question.deadline = deadline;
        break;
      }
      case 'question/closed': {
        const question = questions.get(str(data.callId));
        if (!question) break;
        const outcome = str(data.outcome);
        if (outcome === 'answered') {
          question.answered = true;
          question.closed = undefined;
        } else if (outcome === 'ASK_TIMED_OUT') question.closed = 'timed-out';
        else question.closed = 'cancelled';
        question.deadline = undefined;
        break;
      }
      case 'approval/asked': {
        const id = str(data.id);
        if (!id) break;
        const item = {
          kind: 'approval' as const,
          id,
          toolName: str(data.toolName),
          callId: str(data.callId) || undefined,
          reason: str(data.reason) || undefined,
        };
        approvals.set(id, item);
        current(event.time).items.push(item);
        break;
      }
      case 'approval/decided': {
        const item = approvals.get(str(data.id));
        if (item) item.outcome = str(data.outcome) as ApprovalOutcome;
        break;
      }
      case 'deliverables/presented': {
        const files = Array.isArray(data.files)
          ? data.files.filter((f): f is PresentedFile => record(f) && typeof f.path === 'string')
          : [];
        if (files.length)
          current(event.time).items.push({ kind: 'deliverables', callId: str(data.callId), files });
        break;
      }
      case 'session/title':
        if (typeof data.title === 'string' && data.title.trim()) title = data.title.trim();
        break;
      case 'compaction/start':
        compacting = true;
        break;
      case 'compaction/end':
        compacting = false;
        break;
      case 'llm/retry-started':
        retrying = true;
        break;
    }
  }
  // A tool still running when its turn closed did not finish; show it as interrupted, not running.
  for (const turn of turns)
    if (turn.end)
      for (const item of turn.items) {
        if (item.kind === 'tool' && item.status === 'running') item.status = 'interrupted';
        if (turn.end.kind === 'aborted') {
          if (item.kind === 'question' && !item.answered && item.closed !== 'timed-out') item.closed = 'cancelled';
          if (item.kind === 'approval' && !item.outcome) item.outcome = 'cancelled';
        }
      }
  // A timed-out question can still be answered late, so it stays pending; a cancelled one does not.
  const pendingQuestions = [...questions.values()].filter((q) => !q.answered && q.closed !== 'cancelled');
  return {
    title,
    turns,
    running: !!open,
    pending: {
      approvals: [...approvals.values()].filter((a) => !a.outcome).length,
      questions: pendingQuestions.length,
      planReview: pendingQuestions.some((q) => q.questions.some((i) => i.intent?.kind === 'plan-review')),
    },
    maintenance: compacting ? 'compacting' : retrying && open ? 'retrying' : null,
    lastSeq,
  };
}

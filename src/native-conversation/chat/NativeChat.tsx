import { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  ChevronRight,
  CircleAlert,
  FileText,
  Folder,
  Loader2,
  Sparkles,
  Square,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import { Button } from '../../shared/ui';
import { ReplyText } from '../../conversation/ReplyText';
import type { QuestionAnswer, QuestionItem } from './events.ts';
import type { Item, ToolItem, Transcript, Turn } from './transcript.ts';
import { toolLabel, toolSummary } from './tools.ts';
import { maskSecrets } from './secrets.ts';
import './native-chat.css';

/**
 * Run state and budget from the platform (B3). `stale` means no report in the last 10 seconds: the
 * last figures are kept for reference but the run state falls back to the log. Absent fields are not shown.
 */
export type NativeStatus = {
  running?: boolean;
  stale?: boolean;
  synthetic?: boolean;
  budget?: {
    /** Settled cost. */
    usedYuan: number;
    /** In-flight and unknown usage held back conservatively; used + reserved counts against limits. */
    reservedYuan?: number;
    softYuan: number;
    hardYuan: number;
    elapsedMinutes?: number;
    blocked?: string | null;
  };
};

/**
 * Each action exists only once the platform offers the matching endpoint (B2). A missing action
 * keeps its control visible but disabled with the reason, so nothing looks available that is not.
 */
export type NativeChatActions = {
  send?: (text: string) => Promise<void>;
  stop?: () => Promise<void>;
  answer?: (callId: string, answers: QuestionAnswer[]) => Promise<void>;
  decide?: (approvalId: string, allow: boolean) => Promise<void>;
  review?: (callId: string, approve: boolean, comment?: string) => Promise<void>;
  feedback?: (messageKey: string, value: 'up' | 'down') => Promise<void>;
};

/** A skill the employee can call from the composer by typing `/`. */
export type NativeSkill = { name: string; description?: string };

/** Why the controls are disabled; the page supplies it (session stopped, runtime off, preview…). */
const Unavailable = createContext('当前不可操作');
/** Opens the results tab beside the conversation, where delivered files are downloaded and published. */
const OpenResults = createContext<(() => void) | undefined>(undefined);
const failure = (e: unknown) => (e instanceof Error ? e.message : '操作未完成，请稍后重试。');

export function NativeChat({
  transcript,
  status,
  actions,
  skills = [],
  ratings,
  unavailable = '当前不可操作',
  loading = false,
  notice,
  workspace,
  onOpenResults,
}: {
  transcript: Transcript;
  status?: NativeStatus;
  actions: NativeChatActions;
  skills?: NativeSkill[];
  /** Ratings the employee already gave, by feedback key. */
  ratings?: ReadonlyMap<string, 'up' | 'down'>;
  unavailable?: string;
  loading?: boolean;
  /** Connection or load problem worth telling the reader about; the log shown so far stays. */
  notice?: string;
  /** The space the session belongs to, shown in the composer like the 梦擎 composer does. */
  workspace?: string;
  onOpenResults?: () => void;
}) {
  const running =
    status && !status.stale && status.running !== undefined ? status.running : transcript.running;
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Follow new content only when the reader is already near the end.
    const el = scroll.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight;
  }, [transcript.lastSeq]);
  const lastDone = transcript.turns.findLastIndex((t) => t.end?.kind === 'completed');
  return (
    <Unavailable.Provider value={unavailable}>
      <OpenResults.Provider value={onOpenResults}>
        <div
          className="native-chat"
          onKeyDown={(e) => {
            // Esc stops the current round, like the official window; it never closes the page.
            if (e.key === 'Escape' && running && actions.stop && !e.defaultPrevented) {
              e.preventDefault();
              void actions.stop().catch(() => undefined);
            }
          }}
        >
          <NativeStatusLine transcript={transcript} status={status} notice={notice} />
          <div className="native-chat-scroll conversation-messages" ref={scroll} aria-live="polite">
            {loading ? (
              <p className="native-empty" role="status">
                <Loader2 size={14} className="native-spin" aria-hidden="true" /> 正在载入会话记录…
              </p>
            ) : (
              !transcript.turns.length && (
                <p className="native-empty">在下面输入你想处理的工作，会话会在这里展开。</p>
              )
            )}
            {transcript.turns.map((turn, index) => (
              <NativeTurn
                key={`${turn.turn}:${index}`}
                turn={turn}
                actions={actions}
                rating={index === lastDone ? ratings : undefined}
                rateable={index === lastDone}
              />
            ))}
          </div>
          <NativeComposer running={running} actions={actions} skills={skills} workspace={workspace} />
        </div>
      </OpenResults.Provider>
    </Unavailable.Provider>
  );
}

/**
 * One line, only when something needs the employee: a pending decision, a budget limit, a load
 * problem. Run state lives in the reply itself and in the stop button.
 */
function NativeStatusLine({
  transcript,
  status,
  notice,
}: {
  transcript: Transcript;
  status?: NativeStatus;
  notice?: string;
}) {
  const { approvals, questions, planReview } = transcript.pending;
  const waiting = approvals + questions;
  const budget = status?.budget;
  const occupied = budget ? budget.usedYuan + (budget.reservedYuan ?? 0) : 0;
  const goTo = () =>
    document
      .querySelector('.native-chat [data-pending]')
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const [text, tone, action] = notice
    ? [notice, 'warn', null]
    : planReview
      ? ['AI 拟好了执行计划，等你审阅后开始', 'warn', '去审阅']
      : waiting
        ? [
            waiting > 1 ? `AI 暂停了，有 ${waiting} 件事等你处理` : 'AI 暂停了，等你确认一件事',
            'warn',
            '去处理',
          ]
        : budget?.blocked || (budget && occupied >= budget.hardYuan)
          ? [`本次费用已到上限 ¥${budget.hardYuan}，已暂停执行`, 'error', null]
          : budget && occupied >= budget.softYuan
            ? [`本次费用 ¥${occupied.toFixed(2)}，已超过提醒线 ¥${budget.softYuan}`, 'warn', null]
            : transcript.maintenance
              ? [transcript.maintenance === 'compacting' ? '正在整理上下文…' : '模型重试中…', 'info', null]
              : [null, null, null];
  if (!text) return null;
  return (
    <div className={`native-status-line is-${tone}`} role="status">
      <span className="native-dot" aria-hidden="true" />
      <span className="native-status-text">{text}</span>
      {action && (
        <button type="button" className="native-link" onClick={goTo}>
          {action}
        </button>
      )}
    </div>
  );
}

function NativeTurn({
  turn,
  actions,
  rating,
  rateable,
}: {
  turn: Turn;
  actions: NativeChatActions;
  rating?: ReadonlyMap<string, 'up' | 'down'>;
  rateable: boolean;
}) {
  const assistants = turn.items.filter((i) => i.kind === 'assistant');
  const last = turn.items.at(-1);
  // The reply is the turn's closing text; earlier text is narration and goes with the process.
  const reply =
    assistants.at(-1) && (turn.end || last?.kind === 'assistant') && assistants.at(-1)!.text
      ? assistants.at(-1)!
      : undefined;
  const process = turn.items.filter(
    (i): i is Extract<Item, { kind: 'assistant' }> | ToolItem =>
      i.kind === 'tool' || (i.kind === 'assistant' && (i !== reply || !!i.reasoning)),
  );
  const current = !turn.end
    ? [...turn.items].reverse().find((i) => i.kind === 'tool' && i.status === 'running')
    : undefined;
  const asks = turn.items.filter((i) => i.kind === 'approval' || i.kind === 'question');
  const files = turn.items.filter((i) => i.kind === 'deliverables');
  return (
    <article className="conversation-turn native-turn">
      {turn.prompts.map((p) => (
        <p key={p.id} className="conversation-user">
          {maskSecrets(p.text)}
          {(p.attachments > 0 || p.references > 0) && (
            <small className="native-attachments">
              {[p.attachments && `附件 ${p.attachments} 个`, p.references && `引用资料 ${p.references} 份`]
                .filter(Boolean)
                .join(' · ')}
            </small>
          )}
        </p>
      ))}
      <div className="conversation-result native-result">
        {!turn.end && (
          <p className="native-now">
            <Loader2 size={13} className="native-spin" aria-hidden="true" />
            {current?.kind === 'tool' ? `正在${toolLabel(current.name)}…` : '正在处理…'}
          </p>
        )}
        {reply && (
          <div className="conversation-reply">
            <ReplyText text={reply.text} />
            {reply.interrupted && <small className="native-muted">（回复被中断）</small>}
          </div>
        )}
        {process.length > 0 && <NativeProcess items={process} reply={reply} />}
        {files.map((f) =>
          f.kind === 'deliverables' ? <NativeFiles key={`files:${f.callId}`} item={f} /> : null,
        )}
        {asks.map((item) =>
          item.kind === 'approval' ? (
            <NativeApprovalCard key={`approval:${item.id}`} item={item} actions={actions} />
          ) : item.kind === 'question' ? (
            <NativeQuestionCard key={`question:${item.callId}`} item={item} actions={actions} />
          ) : null,
        )}
        {turn.end?.kind === 'aborted' && <p className="native-turn-end">本轮已停止。</p>}
        {turn.end?.kind === 'blocked' && <p className="native-turn-end">本轮被拦下，未继续执行。</p>}
        {turn.end?.kind === 'error' && (
          <p className="native-turn-end is-error">
            <CircleAlert size={14} aria-hidden="true" />
            本轮出错结束
            {'error' in turn.end &&
            turn.end.error &&
            typeof turn.end.error === 'object' &&
            'message' in turn.end.error
              ? `：${String(turn.end.error.message)}`
              : '。'}
          </p>
        )}
        {rateable && reply && (
          <NativeFeedback
            key={reply.feedbackKey}
            messageKey={reply.feedbackKey}
            initial={rating?.get(reply.feedbackKey) ?? null}
            actions={actions}
          />
        )}
      </div>
    </article>
  );
}

const statusText: Record<ToolItem['status'], string> = {
  running: '进行中',
  done: '已完成',
  error: '失败',
  interrupted: '未完成',
};

/** The 梦擎 pattern: the whole process folds into one line under the reply. */
function NativeProcess({
  items,
  reply,
}: {
  items: (Extract<Item, { kind: 'assistant' }> | ToolItem)[];
  reply?: Extract<Item, { kind: 'assistant' }>;
}) {
  const tools = items.filter((i): i is ToolItem => i.kind === 'tool');
  const failed = tools.filter((t) => t.status === 'error').length;
  return (
    <details className="native-process">
      <summary>
        <ChevronRight size={14} className="native-chevron" aria-hidden="true" />
        处理过程{tools.length ? ` · ${tools.length} 步` : ''}
        {failed > 0 && <span className="native-failed">，{failed} 步失败</span>}
      </summary>
      <div className="native-process-body">
        {items.map((item) =>
          item.kind === 'tool' ? (
            <NativeToolLine key={item.callId} tool={item} />
          ) : (
            <div key={item.key} className="native-narration">
              {item.reasoning && <p className="native-reasoning">{item.reasoning}</p>}
              {item !== reply && item.text && <ReplyText text={item.text} />}
            </div>
          ),
        )}
      </div>
    </details>
  );
}

function NativeToolLine({ tool }: { tool: ToolItem }) {
  const summary = toolSummary(tool.name, tool.arguments);
  return (
    <details className={`native-tool is-${tool.status}`}>
      <summary>
        <span className="native-tool-name">{toolLabel(tool.name)}</span>
        <span className="native-tool-status">{statusText[tool.status]}</span>
      </summary>
      <div className="native-tool-detail">
        {summary && <p>{summary}</p>}
        <h4>调用参数</h4>
        <pre>{tool.arguments || '（无）'}</pre>
        {(tool.result || tool.error) && (
          <>
            <h4>{tool.error ? '失败原因' : '结果'}</h4>
            <pre>{(tool.error || tool.result).slice(0, 4000)}</pre>
          </>
        )}
      </div>
    </details>
  );
}

function NativeFiles({ item }: { item: Extract<Item, { kind: 'deliverables' }> }) {
  const open = useContext(OpenResults);
  return (
    <ul className="native-files-inline">
      {item.files.map((f) => (
        <li key={f.path} className="native-file">
          <span className="native-file-icon">
            <FileText size={16} aria-hidden="true" />
          </span>
          <span className="native-file-name">
            <strong>{f.path.split('/').pop()}</strong>
            <small>{f.description || '交付文件'}</small>
          </span>
          {open && (
            <button type="button" className="native-link" onClick={open}>
              在成果中查看
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

const approvalText: Record<string, string> = {
  'allowed-once': '已允许',
  rejected: '已拒绝',
  cancelled: '已取消',
  unavailable: '未能处理',
};

function NativeApprovalCard({
  item,
  actions,
}: {
  item: Extract<Item, { kind: 'approval' }>;
  actions: NativeChatActions;
}) {
  const unavailable = useContext(Unavailable);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (item.outcome)
    return (
      <p className="native-ask-settled">
        {approvalText[item.outcome] ?? '已处理'}：{toolLabel(item.toolName)}
      </p>
    );
  const decide = async (allow: boolean) => {
    if (!actions.decide) return;
    setBusy(true);
    setError('');
    try {
      await actions.decide(item.id, allow);
    } catch (e) {
      setError(failure(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="native-ask" data-pending>
      <span className="native-ask-label">等你确认</span>
      <p>
        AI 想{toolLabel(item.toolName)}
        {item.reason ? `：${item.reason}` : '。'}
      </p>
      <div className="native-actions">
        <Button
          variant="primary"
          disabled={busy || !actions.decide}
          title={actions.decide ? undefined : unavailable}
          onClick={() => decide(true)}
        >
          允许
        </Button>
        <Button disabled={busy || !actions.decide} onClick={() => decide(false)}>
          拒绝
        </Button>
      </div>
      {!actions.decide && <p className="native-muted">{unavailable}</p>}
      {error && (
        <p className="native-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function NativeQuestionCard({
  item,
  actions,
}: {
  item: Extract<Item, { kind: 'question' }>;
  actions: NativeChatActions;
}) {
  const plan = item.questions.length === 1 && item.questions[0].intent?.kind === 'plan-review';
  if (item.answered)
    return (
      <p className="native-ask-settled">
        {plan ? '计划已审阅' : '已回答'}
        {item.answer ? `：${item.answer}` : ''}
      </p>
    );
  if (item.closed === 'cancelled')
    return <p className="native-ask-settled">{plan ? '计划审阅已取消' : '提问已取消'}，这一轮已结束。</p>;
  return (
    <div className="native-ask" data-pending>
      <span className="native-ask-label">
        {plan ? '执行计划 · 等你审阅' : 'AI 在等你回答'}
        {item.deadline && <Countdown deadline={item.deadline} />}
      </span>
      {item.closed === 'timed-out' && (
        <p className="native-muted">等待已超时，AI 先按自己的判断继续了；现在回答仍会送达，AI 会据此调整。</p>
      )}
      {plan ? (
        <PlanReview item={item} question={item.questions[0]} actions={actions} />
      ) : (
        <QuestionForm item={item} actions={actions} />
      )}
    </div>
  );
}

/** Remaining time on a timed question; the server decides when it actually times out. */
function Countdown({ deadline }: { deadline: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = Math.max(0, Math.round((deadline - now) / 1000));
  if (!left) return null;
  return (
    <span className="native-countdown">
      · {left >= 60 ? `${Math.floor(left / 60)} 分 ${left % 60} 秒` : `${left} 秒`}内回答
    </span>
  );
}

function QuestionForm({
  item,
  actions,
}: {
  item: Extract<Item, { kind: 'question' }>;
  actions: NativeChatActions;
}) {
  const unavailable = useContext(Unavailable);
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (skip: boolean) => {
    if (!actions.answer) return;
    setBusy(true);
    setError('');
    try {
      await actions.answer(
        item.callId,
        item.questions.map((q) =>
          skip
            ? { id: q.id, selected: [] }
            : {
                id: q.id,
                selected: picked[q.id] ?? [],
                ...(custom[q.id]?.trim() ? { custom: custom[q.id].trim() } : {}),
              },
        ),
      );
    } catch (e) {
      setError(failure(e));
    } finally {
      setBusy(false);
    }
  };
  const toggle = (q: QuestionItem, label: string) =>
    setPicked((p) => {
      const current = p[q.id] ?? [];
      const next = q.multiSelect
        ? current.includes(label)
          ? current.filter((x) => x !== label)
          : [...current, label]
        : current.includes(label)
          ? []
          : [label];
      return { ...p, [q.id]: next };
    });
  const ready = item.questions.every((q) => (picked[q.id]?.length ?? 0) > 0 || custom[q.id]?.trim());
  return (
    <>
      <fieldset disabled={busy || !actions.answer}>
        {item.questions.map((q) => (
          <div key={q.id} className="native-question-item">
            <p>
              {q.header && <span className="native-question-header">{q.header} · </span>}
              {q.question}
            </p>
            {q.detail && <small className="native-muted">{q.detail}</small>}
            {!!q.options?.length && (
              <div className="native-options" role="group" aria-label={q.question}>
                {q.options.map((o) => (
                  <Button
                    key={o.label}
                    aria-pressed={(picked[q.id] ?? []).includes(o.label)}
                    title={o.description}
                    onClick={() => toggle(q, o.label)}
                  >
                    {o.label}
                  </Button>
                ))}
              </div>
            )}
            <textarea
              className="native-custom"
              rows={1}
              aria-label={`补充回答：${q.question}`}
              placeholder="补充说明（可选）"
              value={custom[q.id] ?? ''}
              onChange={(e) => setCustom((c) => ({ ...c, [q.id]: e.target.value }))}
            />
          </div>
        ))}
        <div className="native-actions">
          <Button
            variant="primary"
            disabled={!ready}
            title={actions.answer ? undefined : unavailable}
            onClick={() => submit(false)}
          >
            提交回答
          </Button>
          <Button variant="ghost" onClick={() => submit(true)}>
            跳过
          </Button>
        </div>
      </fieldset>
      {!actions.answer && <p className="native-muted">{unavailable}</p>}
      {error && (
        <p className="native-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

/**
 * Plan review goes through its own endpoint so approval is the runtime's named approve option,
 * never an ordinary message (appendix C). Revising needs a note on what to change.
 */
function PlanReview({
  item,
  question,
  actions,
}: {
  item: Extract<Item, { kind: 'question' }>;
  question: QuestionItem;
  actions: NativeChatActions;
}) {
  const unavailable = useContext(Unavailable);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const review = async (approve: boolean) => {
    if (!actions.review) return;
    setBusy(true);
    setError('');
    try {
      await actions.review(item.callId, approve, approve ? undefined : comment.trim());
    } catch (e) {
      setError(failure(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <fieldset disabled={busy || !actions.review}>
        <div className="native-question-item">
          <ReplyText text={question.question} />
          {question.detail && <small className="native-muted">{question.detail}</small>}
          <textarea
            className="native-custom"
            rows={2}
            maxLength={10000}
            aria-label="需要调整的地方"
            placeholder="需要调整的地方（退回修改时填写）"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </div>
        <div className="native-actions">
          <Button
            variant="primary"
            title={actions.review ? undefined : unavailable}
            onClick={() => review(true)}
          >
            {question.intent?.approve || '按计划执行'}
          </Button>
          <Button disabled={!comment.trim()} onClick={() => review(false)}>
            退回修改
          </Button>
        </div>
      </fieldset>
      {!actions.review && <p className="native-muted">{unavailable}</p>}
      {error && (
        <p className="native-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

/** Shown on the last finished reply only; on pointer devices it appears when the reply is hovered. */
function NativeFeedback({
  messageKey,
  initial,
  actions,
}: {
  messageKey: string;
  initial: 'up' | 'down' | null;
  actions: NativeChatActions;
}) {
  const [sent, setSent] = useState<'up' | 'down' | null>(initial);
  useEffect(() => setSent(initial), [initial]);
  if (!actions.feedback) return null;
  const send = async (value: 'up' | 'down') => {
    try {
      await actions.feedback?.(messageKey, value);
      setSent(value);
    } catch {
      /* feedback is optional; the control stays available for another try */
    }
  };
  return (
    <div className={`native-feedback ${sent ? 'is-rated' : ''}`}>
      <button type="button" aria-label="有用" aria-pressed={sent === 'up'} onClick={() => send('up')}>
        <ThumbsUp size={14} />
      </button>
      <button type="button" aria-label="没用" aria-pressed={sent === 'down'} onClick={() => send('down')}>
        <ThumbsDown size={14} />
      </button>
    </div>
  );
}

/** Uses the 梦擎 composer's own classes so both conversation pages share one input. */
function NativeComposer({
  running,
  actions,
  skills,
  workspace,
}: {
  running: boolean;
  actions: NativeChatActions;
  skills: NativeSkill[];
  workspace?: string;
}) {
  const unavailable = useContext(Unavailable);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const composing = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  // `/` at the start of the box opens the skill list; the typed word filters it.
  const slash = /^\/(\S*)$/.exec(text);
  const matches = slash
    ? skills.filter((k) => k.name.toLowerCase().includes(slash[1].toLowerCase())).slice(0, 8)
    : [];
  const menu = !dismissed && !!slash && skills.length > 0;
  const pick = (skill: NativeSkill) => {
    setText(`/${skill.name} `);
    setActive(0);
    input.current?.focus();
  };
  const send = async () => {
    if (!actions.send || !text.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await actions.send(text.trim());
      setText('');
    } catch (e) {
      setError(failure(e));
    } finally {
      setBusy(false);
    }
  };
  const stop = async () => {
    try {
      await actions.stop?.();
    } catch (e) {
      setError(failure(e));
    }
  };
  // While a round runs with nothing typed, the send button becomes the stop button.
  const stopping = running && !text.trim();
  return (
    <form
      className="conversation-composer is-expanded native-composer"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      {menu && (
        <ul className="native-skill-menu" role="listbox" id="native-skill-menu" aria-label="技能">
          {matches.length ? (
            matches.map((skill, i) => (
              <li
                key={skill.name}
                role="option"
                id={`native-skill-${i}`}
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(skill);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <Sparkles size={14} aria-hidden="true" />
                <span>
                  {skill.name}
                  {skill.description && <small>{skill.description}</small>}
                </span>
              </li>
            ))
          ) : (
            <li className="native-muted">没有匹配的技能</li>
          )}
        </ul>
      )}
      <div className="live-composer-surface">
        {error && (
          <div className="composer-notices">
            <p className="native-error" role="alert">
              {error}
            </p>
          </div>
        )}
        <div className="live-composer-input">
          <textarea
            ref={input}
            aria-label="工作要求"
            aria-controls={menu ? 'native-skill-menu' : undefined}
            aria-activedescendant={menu && matches.length ? `native-skill-${active}` : undefined}
            rows={2}
            maxLength={8000}
            value={text}
            disabled={!actions.send}
            placeholder={
              actions.send
                ? skills.length
                  ? '告诉我你想处理的工作，输入 / 调用技能'
                  : '告诉我你想处理的工作'
                : unavailable
            }
            onChange={(e) => {
              setText(e.target.value);
              setActive(0);
              setDismissed(false);
            }}
            onCompositionStart={() => (composing.current = true)}
            onCompositionEnd={() => (composing.current = false)}
            onKeyDown={(e) => {
              if (menu && !composing.current && !e.nativeEvent.isComposing) {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  if (matches.length)
                    setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length);
                  return;
                }
                if ((e.key === 'Enter' || e.key === 'Tab') && matches[active]) {
                  e.preventDefault();
                  pick(matches[active]);
                  return;
                }
                if (e.key === 'Escape') {
                  // Close the list only; Esc to stop the round applies when no list is open.
                  e.preventDefault();
                  setDismissed(true);
                  return;
                }
              }
              if (e.key === 'Enter' && !e.shiftKey && !composing.current && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
          />
        </div>
        <div className="live-composer-controls">
          <div className="live-composer-controls-content">
            <div className="live-composer-tools">
              {workspace && (
                <span className="button live-workspace-label" title="会话工作空间">
                  <Folder size={16} aria-hidden="true" />
                  {workspace}
                </span>
              )}
            </div>
          </div>
        </div>
        {stopping ? (
          <Button
            icon={Square}
            className="live-composer-submit native-stop"
            variant="primary"
            aria-label="停止本轮"
            title={actions.stop ? '停止本轮（Esc）' : unavailable}
            disabled={!actions.stop}
            onClick={() => void stop()}
          />
        ) : (
          <Button
            icon={ArrowUp}
            className="live-composer-submit"
            type="submit"
            variant="primary"
            aria-label="发送"
            disabled={!actions.send || !text.trim() || busy}
          />
        )}
      </div>
    </form>
  );
}

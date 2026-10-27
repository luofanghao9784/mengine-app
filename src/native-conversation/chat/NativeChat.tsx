import { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Check,
  ChevronRight,
  CircleAlert,
  CircleStop,
  FileText,
  ListChecks,
  Loader2,
  ShieldQuestion,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Wrench,
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
const failure = (e: unknown) => (e instanceof Error ? e.message : '操作未完成，请稍后重试。');

export function NativeChat({
  transcript,
  status,
  actions,
  summary = '',
  skills = [],
  ratings,
  unavailable = '当前不可操作',
  loading = false,
  notice,
}: {
  transcript: Transcript;
  status?: NativeStatus;
  actions: NativeChatActions;
  /** One-line long-task progress, e.g. "待办 1/3 · 后台 1 个进行中". */
  summary?: string;
  skills?: NativeSkill[];
  /** Ratings the employee already gave, by feedback key. */
  ratings?: ReadonlyMap<string, 'up' | 'down'>;
  unavailable?: string;
  loading?: boolean;
  /** Connection or load problem worth telling the reader about; the log shown so far stays. */
  notice?: string;
}) {
  const running =
    status && !status.stale && status.running !== undefined ? status.running : transcript.running;
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Follow new content only when the reader is already near the end.
    const el = scroll.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight;
  }, [transcript.lastSeq]);
  return (
    <Unavailable.Provider value={unavailable}>
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
        <NativeStatusBar
          running={running}
          status={status}
          maintenance={transcript.maintenance}
          pending={transcript.pending}
          summary={summary}
        />
        {notice && (
          <p className="native-notice" role="status">
            {notice}
          </p>
        )}
        <div className="native-chat-scroll conversation-messages" ref={scroll} aria-live="polite">
          {loading ? (
            <p className="native-empty" role="status">
              <Loader2 size={14} className="native-spin" aria-hidden="true" /> 正在载入会话记录…
            </p>
          ) : (
            !transcript.turns.length && (
              <p className="native-empty">在下面输入你想处理的工作，原生会话会在这里展开。</p>
            )
          )}
          {transcript.turns.map((turn, index) => (
            <NativeTurn key={`${turn.turn}:${index}`} turn={turn} actions={actions} ratings={ratings} />
          ))}
        </div>
        <NativeComposer running={running} actions={actions} skills={skills} />
      </div>
    </Unavailable.Provider>
  );
}

function NativeStatusBar({
  running,
  status,
  maintenance,
  pending,
  summary,
}: {
  running: boolean;
  status?: NativeStatus;
  maintenance: Transcript['maintenance'];
  pending: Transcript['pending'];
  summary: string;
}) {
  const waiting = pending.approvals + pending.questions;
  const budget = status?.budget;
  const occupied = budget ? budget.usedYuan + (budget.reservedYuan ?? 0) : 0;
  const level = budget
    ? budget.blocked || occupied >= budget.hardYuan
      ? 'hard'
      : occupied >= budget.softYuan
        ? 'soft'
        : 'ok'
    : null;
  return (
    <div className="native-status" role="status">
      <span className={`native-run ${running ? 'is-running' : ''}`}>
        {running ? (
          <Loader2 size={13} className="native-spin" aria-hidden="true" />
        ) : (
          <Check size={13} aria-hidden="true" />
        )}
        {running ? '运行中' : '空闲'}
      </span>
      {maintenance && (
        <span className="native-maintenance">
          {maintenance === 'compacting' ? '正在整理上下文…' : '模型重试中…'}
        </span>
      )}
      {waiting > 0 && (
        <span className="native-waiting">
          {pending.planReview ? '计划等你审阅' : `${waiting} 项等你处理`}
        </span>
      )}
      {summary && (
        <span className="native-progress">
          <ListChecks size={13} aria-hidden="true" />
          {summary}
        </span>
      )}
      {budget && (
        <span
          className={`native-budget is-${level} ${status?.stale ? 'is-stale' : ''}`}
          title="已结算费用；“预留”是进行中和用量未确认的部分，两者合计计入提醒与上限"
        >
          {status?.stale && '最后记录 · '}
          已用 ¥{budget.usedYuan.toFixed(2)}
          {!!budget.reservedYuan && ` · 预留 ¥${budget.reservedYuan.toFixed(2)}`} · 提醒 ¥{budget.softYuan} ·
          上限 ¥{budget.hardYuan}
          {budget.elapsedMinutes !== undefined && ` · 本轮 ${Math.round(budget.elapsedMinutes)} 分钟`}
          {budget.blocked && ' · 已达上限，暂停执行'}
        </span>
      )}
      {status?.stale && <span className="native-maintenance">运行状态暂未更新</span>}
      {status?.synthetic && <span className="native-maintenance">测试模型，不产生费用</span>}
    </div>
  );
}

function NativeTurn({
  turn,
  actions,
  ratings,
}: {
  turn: Turn;
  actions: NativeChatActions;
  ratings?: ReadonlyMap<string, 'up' | 'down'>;
}) {
  const lastAssistant = [...turn.items].reverse().find((i) => i.kind === 'assistant');
  return (
    <article className="conversation-turn native-turn">
      {turn.prompts.map((p) => (
        <p key={p.id} className="conversation-user">
          {maskSecrets(p.text)}
          {p.attachments > 0 && <small className="native-attachments">附件 {p.attachments} 个</small>}
          {p.references > 0 && <small className="native-attachments">引用资料 {p.references} 份</small>}
        </p>
      ))}
      <div className="conversation-result">
        {turn.items.map((item) => (
          <NativeItem key={key(item)} item={item} actions={actions} />
        ))}
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
        {turn.end?.kind === 'completed' && lastAssistant && (
          <NativeFeedback
            key={lastAssistant.feedbackKey}
            messageKey={lastAssistant.feedbackKey}
            initial={ratings?.get(lastAssistant.feedbackKey) ?? null}
            actions={actions}
          />
        )}
      </div>
    </article>
  );
}

const key = (item: Item) =>
  item.kind === 'assistant'
    ? item.key
    : item.kind === 'approval'
      ? `approval:${item.id}`
      : item.kind === 'deliverables'
        ? `deliverables:${item.callId}`
        : `${item.kind}:${item.callId}`;

function NativeItem({ item, actions }: { item: Item; actions: NativeChatActions }) {
  switch (item.kind) {
    case 'assistant':
      return (
        <div className="native-assistant">
          {item.reasoning && (
            <details className="native-reasoning">
              <summary>思考过程</summary>
              <p>{item.reasoning}</p>
            </details>
          )}
          {item.text && (
            <div className="conversation-reply">
              <ReplyText text={item.text} />
            </div>
          )}
          {item.interrupted && <small className="native-muted">（回复被中断）</small>}
        </div>
      );
    case 'tool':
      return <NativeToolCard tool={item} />;
    case 'approval':
      return <NativeApprovalCard item={item} actions={actions} />;
    case 'question':
      return <NativeQuestionCard item={item} actions={actions} />;
    case 'deliverables':
      return (
        <div className="native-card native-deliverables">
          <header>
            <FileText size={15} aria-hidden="true" />
            交付了 {item.files.length} 个文件
          </header>
          <ul>
            {item.files.map((f) => (
              <li key={f.path}>
                <span>{f.path.split('/').pop()}</span>
                {f.description && <small>{f.description}</small>}
              </li>
            ))}
          </ul>
          <p className="native-muted">
            AI 保存为私人成果后，可在下方“私人成果”中下载，并经你确认发布到共享空间。
          </p>
        </div>
      );
  }
}

const statusText: Record<ToolItem['status'], string> = {
  running: '进行中',
  done: '完成',
  error: '失败',
  interrupted: '未完成',
};

function NativeToolCard({ tool }: { tool: ToolItem }) {
  const summary = toolSummary(tool.name, tool.arguments);
  return (
    <details className={`native-card native-tool is-${tool.status}`}>
      <summary>
        <Wrench size={14} aria-hidden="true" />
        <span className="native-tool-name">{toolLabel(tool.name)}</span>
        {summary && <span className="native-tool-summary">{summary}</span>}
        <span className="native-tool-status">
          {tool.status === 'running' && <Loader2 size={12} className="native-spin" aria-hidden="true" />}
          {statusText[tool.status]}
        </span>
        <ChevronRight size={14} className="native-chevron" aria-hidden="true" />
      </summary>
      <div className="native-tool-detail">
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
  const decided = item.outcome;
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
    <div className={`native-card native-approval ${decided ? 'is-settled' : 'is-pending'}`}>
      <header>
        <ShieldQuestion size={15} aria-hidden="true" />
        {decided ? '审批已处理' : '需要你确认'}
      </header>
      <p>
        AI 想要<strong>{toolLabel(item.toolName)}</strong>
        {item.reason ? `：${item.reason}` : '。'}
      </p>
      {decided ? (
        <p className="native-muted">
          {decided === 'allowed-once'
            ? '已允许本次执行。'
            : decided === 'rejected'
              ? '已拒绝。'
              : '审批已失效。'}
        </p>
      ) : (
        <>
          <div className="native-actions">
            <Button
              variant="primary"
              disabled={busy || !actions.decide}
              title={actions.decide ? undefined : unavailable}
              onClick={() => decide(true)}
            >
              允许本次
            </Button>
            <Button
              disabled={busy || !actions.decide}
              title={actions.decide ? undefined : unavailable}
              onClick={() => decide(false)}
            >
              拒绝
            </Button>
          </div>
          {!actions.decide && <p className="native-muted">{unavailable}</p>}
          {error && (
            <p className="native-error" role="alert">
              {error}
            </p>
          )}
        </>
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
  const cancelled = !item.answered && item.closed === 'cancelled';
  const late = !item.answered && item.closed === 'timed-out';
  return (
    <div
      className={`native-card native-question ${plan ? 'is-plan' : ''} ${item.answered || cancelled ? 'is-settled' : 'is-pending'}`}
    >
      <header>
        {plan ? <ListChecks size={15} aria-hidden="true" /> : <ShieldQuestion size={15} aria-hidden="true" />}
        {plan
          ? item.answered
            ? '计划已审阅'
            : cancelled
              ? '计划审阅已取消'
              : 'AI 拟好了执行计划，等你审阅'
          : item.answered
            ? '已回答'
            : cancelled
              ? '提问已取消'
              : 'AI 在等你回答'}
        {!item.answered && !cancelled && item.deadline && <Countdown deadline={item.deadline} />}
      </header>
      {late && (
        <p className="native-muted">等待已超时，AI 先按自己的判断继续了；现在回答仍会送达，AI 会据此调整。</p>
      )}
      {item.answered ? (
        <p className="native-muted">{item.answer || '已提交。'}</p>
      ) : cancelled ? (
        <p className="native-muted">这一轮已结束，这个问题不再需要回答。</p>
      ) : plan ? (
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
      {left >= 60 ? `${Math.floor(left / 60)} 分 ${left % 60} 秒` : `${left} 秒`}内回答
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
        : [label];
      return { ...p, [q.id]: next };
    });
  const ready = item.questions.every((q) => (picked[q.id]?.length ?? 0) > 0 || custom[q.id]?.trim());
  return (
    <>
      <fieldset disabled={busy || !actions.answer}>
        {item.questions.map((q) => (
          <div key={q.id} className="native-question-item">
            {q.header && <span className="native-question-header">{q.header}</span>}
            <p>{q.question}</p>
            {q.detail && <small className="native-muted">{q.detail}</small>}
            {q.options?.map((o) => (
              <label key={o.label} className="native-option">
                <input
                  type={q.multiSelect ? 'checkbox' : 'radio'}
                  name={`${item.callId}:${q.id}`}
                  checked={(picked[q.id] ?? []).includes(o.label)}
                  onChange={() => toggle(q, o.label)}
                />
                <span>
                  {o.label}
                  {o.description && <small>{o.description}</small>}
                </span>
              </label>
            ))}
            <input
              className="native-custom"
              placeholder="其他回答（可选）"
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
      <p className="native-muted">在你确认之前不会开始执行。</p>
      <fieldset disabled={busy || !actions.review}>
        <div className="native-question-item">
          {question.header && <span className="native-question-header">{question.header}</span>}
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
          <Button variant="ghost" disabled={!comment.trim()} onClick={() => review(false)}>
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
    <div className="native-feedback">
      <button type="button" aria-label="有用" aria-pressed={sent === 'up'} onClick={() => send('up')}>
        <ThumbsUp size={14} />
      </button>
      <button type="button" aria-label="没用" aria-pressed={sent === 'down'} onClick={() => send('down')}>
        <ThumbsDown size={14} />
      </button>
    </div>
  );
}

function NativeComposer({
  running,
  actions,
  skills,
}: {
  running: boolean;
  actions: NativeChatActions;
  skills: NativeSkill[];
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
  return (
    <form
      className="native-composer"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      {error && (
        <p className="native-error" role="alert">
          {error}
        </p>
      )}
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
      <div className="native-composer-box">
        <textarea
          ref={input}
          aria-label="工作要求"
          aria-controls={menu ? 'native-skill-menu' : undefined}
          aria-activedescendant={menu && matches.length ? `native-skill-${active}` : undefined}
          rows={1}
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
        <div className="native-composer-actions">
          {running && (
            <Button
              variant="ghost"
              icon={CircleStop}
              disabled={!actions.stop}
              title={actions.stop ? '停止本轮' : unavailable}
              onClick={async () => {
                try {
                  await actions.stop?.();
                } catch (e) {
                  setError(failure(e));
                }
              }}
            >
              停止
            </Button>
          )}
          <Button
            icon={ArrowUp}
            className="native-send"
            type="submit"
            variant="primary"
            aria-label="发送"
            disabled={!actions.send || !text.trim() || busy}
          />
        </div>
      </div>
    </form>
  );
}

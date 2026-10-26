import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Check,
  ChevronRight,
  CircleAlert,
  CircleStop,
  FileText,
  Loader2,
  ShieldQuestion,
  ThumbsDown,
  ThumbsUp,
  Wrench,
} from 'lucide-react';
import { Button } from '../../shared/ui';
import { ReplyText } from '../../conversation/ReplyText';
import type { QuestionAnswer, QuestionItem } from './events.ts';
import type { Item, ToolItem, Transcript, Turn } from './transcript.ts';
import { toolLabel, toolSummary } from './tools.ts';
import './native-chat.css';

/** Budget and run state come from the platform (B3); absent fields are simply not shown. */
export type NativeStatus = {
  running: boolean;
  budget?: { usedYuan: number; softYuan: number; hardYuan: number; elapsedMinutes?: number };
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
  feedback?: (messageKey: string, value: 'up' | 'down') => Promise<void>;
};

const unavailable = '运行环境接通后可用';
const failure = (e: unknown) => (e instanceof Error ? e.message : '操作未完成，请稍后重试。');

export function NativeChat({
  transcript,
  status,
  actions,
}: {
  transcript: Transcript;
  status?: NativeStatus;
  actions: NativeChatActions;
}) {
  const running = status?.running ?? transcript.running;
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Follow new content only when the reader is already near the end.
    const el = scroll.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight;
  }, [transcript.lastSeq]);
  return (
    <div className="native-chat">
      <NativeStatusBar running={running} status={status} maintenance={transcript.maintenance} />
      <div className="native-chat-scroll conversation-messages" ref={scroll} aria-live="polite">
        {!transcript.turns.length && (
          <p className="native-empty">在下面输入你想处理的工作，原生会话会在这里展开。</p>
        )}
        {transcript.turns.map((turn, index) => (
          <NativeTurn key={`${turn.turn}:${index}`} turn={turn} actions={actions} />
        ))}
      </div>
      <NativeComposer running={running} actions={actions} />
    </div>
  );
}

function NativeStatusBar({
  running,
  status,
  maintenance,
}: {
  running: boolean;
  status?: NativeStatus;
  maintenance: Transcript['maintenance'];
}) {
  const budget = status?.budget;
  const level = budget
    ? budget.usedYuan >= budget.hardYuan
      ? 'hard'
      : budget.usedYuan >= budget.softYuan
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
      {budget && (
        <span className={`native-budget is-${level}`} title="本任务已用费用；软阈值提醒，硬上限暂停">
          已用 ¥{budget.usedYuan.toFixed(2)} · 提醒 ¥{budget.softYuan} · 上限 ¥{budget.hardYuan}
          {budget.elapsedMinutes !== undefined && ` · ${Math.round(budget.elapsedMinutes)} 分钟`}
        </span>
      )}
    </div>
  );
}

function NativeTurn({ turn, actions }: { turn: Turn; actions: NativeChatActions }) {
  const lastAssistant = [...turn.items].reverse().find((i) => i.kind === 'assistant');
  return (
    <article className="conversation-turn native-turn">
      {turn.prompts.map((p) => (
        <p key={p.id} className="conversation-user">
          {p.text}
          {p.attachments > 0 && <small className="native-attachments">附件 {p.attachments} 个</small>}
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
          <NativeFeedback messageKey={lastAssistant.key} actions={actions} />
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
          {!actions.decide && <p className="native-muted">{unavailable}；目前请在官方会话窗口里处理。</p>}
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
    <div className={`native-card native-question ${item.answered ? 'is-settled' : 'is-pending'}`}>
      <header>
        <ShieldQuestion size={15} aria-hidden="true" />
        {item.answered ? '已回答' : 'AI 在等你回答'}
      </header>
      {item.answered ? (
        <p className="native-muted">{item.answer || '已提交回答。'}</p>
      ) : (
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
      )}
      {!item.answered && !actions.answer && (
        <p className="native-muted">{unavailable}；目前请在官方会话窗口里回答。</p>
      )}
      {error && (
        <p className="native-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function NativeFeedback({ messageKey, actions }: { messageKey: string; actions: NativeChatActions }) {
  const [sent, setSent] = useState<'up' | 'down' | null>(null);
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

function NativeComposer({ running, actions }: { running: boolean; actions: NativeChatActions }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const composing = useRef(false);
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
      <div className="native-composer-box">
        <textarea
          aria-label="工作要求"
          rows={1}
          maxLength={8000}
          value={text}
          disabled={!actions.send}
          placeholder={actions.send ? '告诉我你想处理的工作' : `${unavailable}；目前请在官方会话窗口里发送`}
          onChange={(e) => setText(e.target.value)}
          onCompositionStart={() => (composing.current = true)}
          onCompositionEnd={() => (composing.current = false)}
          onKeyDown={(e) => {
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

import { useRealtime } from './useRealtime';
import { LiveProcess } from './LiveProcess';
import { liveClient } from './realtime-client';
import type { LiveTask } from '../../contracts/public-api/conversation';
import { useViewState } from '../shared/useViewState';
import { FeedbackPanel } from '../feedback/FeedbackPanel';
import { TaskWorkNotices } from '../taskwork/TaskWorkNotices';
import { RequestPending, requestNavigationLocked, useRequestLock } from '../shared/request-guard';
import { useContext } from 'react';
import { readTabDraft, writeTabDraft, removeTabDraft } from '../shared/tab-drafts';
import { prepareViewportMotion } from './viewport-motion';
import { DraftWarning } from '../shared/DraftWarning';
import { SaveAsDocument } from '../documents/Documents';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Info,
  ArrowUp,
  FileText,
  Files,
  Folder,
  ListChecks,
  MessageCircle,
  Plus,
  Paperclip,
  ChevronDown,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react';
import type {
  ConversationDetail,
  ConversationTask,
  ConversationPage,
  SendTask,
  TaskOriginal,
  TaskAction,
} from '../../contracts/public-api/conversation';
import type { TenantContext } from '../../contracts/public-api/identity';
import { identityClient, useSession } from '../identity/session';
import { IdentityError, record, uuid } from '../identity/client';
import { Button, Badge, Field, PageActions, DocumentText, IconButton } from '../shared/ui';
import { TaskReadingBody, type ReadingTask } from '../briefing-live/TaskReadingBody';
import { readBriefingContext, retainConversationContext } from './briefing-context';
import { LiveConversationDeck } from './LiveConversationDeck';
import type { ReactNode } from 'react';
import { Failure, Loading, Pager, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { Citation } from '../material/Knowledge';
import { ActionPopover } from '../shared/ActionPopover';
import { libraryHref } from '../material/Library';
import { AttachmentMaterials, AttachmentReader } from './AttachmentMaterials';
import { taskErrorMessage } from './task-errors';
import { conversationClient as api, isOriginal } from './client';
import './conversation.css';
export const conversationHref = (tenant: string, id?: string) =>
  '#' + new URLSearchParams({ tenant, view: 'conversations', ...(id ? { conversation: id } : {}) });
export function Conversations({ tenant }: { tenant: string }) {
  const { session, expire } = useSession();
  const pendingRequest = useContext(RequestPending);
  const [contextAttempt, setContextAttempt] = useState(0);
  const [hash, setHash] = useState(location.hash),
    [attempt, setAttempt] = useState(0),
    [page, setPage] = useState(0);
  useEffect(() => {
    const change = () => {
      if (!requestNavigationLocked()) setHash(location.hash);
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  const selected = new URLSearchParams(hash.slice(1)).get('conversation') || undefined;
  const focused = new URLSearchParams(hash.slice(1)).get('task') || undefined;
  const context = useRemote(
    (signal) => identityClient.context(tenant, signal),
    [tenant, session.identity, contextAttempt],
  );
  const [list, setList] = useState<{ value?: ConversationPage; error?: unknown }>({});
  useEffect(() => {
    const controller = new AbortController();
    void api
      .list(tenant, page * 20, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setList({ value });
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setList({ error });
          if (error instanceof IdentityError && error.status === 401) expire();
        }
      });
    return () => controller.abort();
  }, [tenant, page, attempt, session.identity, expire]);
  const changed = useCallback(() => setAttempt((x) => x + 1), []);
  return (
    <>
      <PageActions>
        <Button
          variant="ghost"
          icon={RefreshCw}
          disabled={pendingRequest}
          onClick={() => {
            changed();
            setContextAttempt((x) => x + 1);
          }}
        >
          刷新
        </Button>
      </PageActions>
      {context.error || list.error ? (
        <Failure
          error={context.error || list.error}
          retry={() => {
            changed();
            setContextAttempt((x) => x + 1);
          }}
        />
      ) : !context.value || !list.value ? (
        <Loading />
      ) : (
        <ConversationView
          key={(selected || 'new') + ':' + (focused || '') + ':' + (readBriefingContext(hash)?.taskId || '')}
          tenant={tenant}
          selected={selected}
          focused={focused}
          briefingContext={readBriefingContext(hash)}
          context={context.value}
          enabled={list.value.enabled}
          agentMode={list.value.agentMode}
          publicWebEnabled={list.value.publicWebEnabled}
          changed={changed}
          navigation={
            <nav className="live-conversation-list" aria-label="会话列表">
              <div className="live-list-tools">
                <header className="deck-card-header live-card-heading">
                  <h2>会话列表</h2>
                  <span>仅自己可见</span>
                </header>
                <Button
                  className="live-new-conversation"
                  icon={Plus}
                  disabled={pendingRequest}
                  onClick={() => {
                    location.hash = retainConversationContext(conversationHref(tenant), location.hash);
                  }}
                >
                  新会话
                </Button>
              </div>
              <div className="live-conversation-links">
                {context.value.workspaces.map((space) => {
                  const conversations = list.value!.items.filter((item) => item.workspaceId === space.id);
                  return conversations.length ? (
                    <details className="live-conversation-group" key={space.id} open>
                      <summary>
                        <Folder size={14} />
                        {space.kind === 'PERSONAL' ? '个人空间' : space.name}
                      </summary>
                      {conversations.map((c) => (
                        <a
                          key={c.id}
                          className={selected === c.id ? 'selected' : ''}
                          href={retainConversationContext(conversationHref(tenant, c.id), hash)}
                          aria-current={selected === c.id ? 'page' : undefined}
                          onClick={(event) => {
                            if (pendingRequest) event.preventDefault();
                          }}
                        >
                          <MessageCircle size={15} />
                          <span title={c.title}>{c.title}</span>
                        </a>
                      ))}
                    </details>
                  ) : null;
                })}
                {list.value.items.some(
                  (item) => !context.value!.workspaces.some((space) => space.id === item.workspaceId),
                ) && (
                  <section className="live-conversation-group">
                    <h3>其他会话</h3>
                    {list.value.items
                      .filter(
                        (item) => !context.value!.workspaces.some((space) => space.id === item.workspaceId),
                      )
                      .map((c) => (
                        <a
                          key={c.id}
                          className={selected === c.id ? 'selected' : ''}
                          href={retainConversationContext(conversationHref(tenant, c.id), hash)}
                          aria-current={selected === c.id ? 'page' : undefined}
                          onClick={(event) => {
                            if (pendingRequest) event.preventDefault();
                          }}
                        >
                          <MessageCircle size={15} />
                          <span title={c.title}>{c.title}</span>
                        </a>
                      ))}
                  </section>
                )}
                {!list.value.items.length && (
                  <p className="live-list-empty">从一件具体的工作开始。发送后，会话会保存在这里。</p>
                )}
              </div>
              {(page > 0 || list.value.hasMore) && (
                <Pager
                  page={page}
                  next={list.value.hasMore}
                  onPage={(next) => {
                    if (!pendingRequest) setPage(next);
                  }}
                />
              )}
            </nav>
          }
        />
      )}
    </>
  );
}
function ConversationView({
  tenant,
  selected,
  focused,
  context,
  enabled,
  agentMode,
  publicWebEnabled,
  changed,
  navigation,
  briefingContext,
}: {
  briefingContext?: ReadingTask;
  navigation: ReactNode;
  tenant: string;
  selected?: string;
  focused?: string;
  context: TenantContext;
  enabled: boolean;
  agentMode: ConversationPage['agentMode'];
  publicWebEnabled: boolean;
  changed: () => void;
}) {
  const { session, expire } = useSession();
  const pendingRequest = useContext(RequestPending);
  const [data, setData] = useState<{ value?: ConversationDetail; error?: unknown }>({});
  const [attempt, setAttempt] = useState(0),
    [page, setPage] = useState(0);
  const readerKey = 'conversation:' + (selected || 'new');
  const [citations, setCitations] = useViewState<{ id: string; title: string }[]>(
    tenant,
    readerKey + ':citations',
    [],
    (v): v is { id: string; title: string }[] =>
      Array.isArray(v) &&
      v.length <= 50 &&
      v.every((c) => record(c) && uuid(c.id) && typeof c.title === 'string' && c.title.length <= 300),
  );
  const [properties, setProperties] = useViewState<string[]>(
    tenant,
    readerKey + ':properties',
    [],
    (v): v is string[] => Array.isArray(v) && v.length <= 50 && v.every(uuid),
  );
  const [reveal, setReveal] = useState<{ id: string; sequence: number }>();
  const [briefingOpen, setBriefingOpen] = useState(!!briefingContext);
  const [briefingTitle, setBriefingTitle] = useState<string>();
  const openCitation = (id: string, title: string) => {
    setCitations((all) => (all.some((c) => c.id === id) ? all : [...all, { id, title }]));
    setReveal((previous) => ({ id, sequence: (previous?.sequence || 0) + 1 }));
  };
  const [suggestion, setSuggestion] = useState<{ text: string; sequence: number }>();
  const valueRef = useRef<ConversationDetail | undefined>(undefined);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const failure = (error: unknown) => {
      if (controller.signal.aborted) return;
      valueRef.current = undefined;
      setData({ error });
      if (error instanceof IdentityError && [403, 404].includes(error.status)) changed();
      if (error instanceof IdentityError && error.status === 401) expire();
    };
    const load = async () => {
      const value = focused
        ? await api.taskDetail(tenant, selected, focused, controller.signal)
        : await api.detail(tenant, selected, page * 20, controller.signal);
      if (!controller.signal.aborted) {
        valueRef.current = value;
        setData({ value });
      }
    };
    const poll = async () => {
      try {
        const events = await api.events(tenant, selected, valueRef.current?.cursor || 0, controller.signal);
        if (events.items.some((e) => e.kind !== 'LIVE') && !pendingRequest) {
          await load();
          changed();
        }
        if (valueRef.current && events.cursor > valueRef.current.cursor)
          valueRef.current = { ...valueRef.current, cursor: events.cursor };
        if (!controller.signal.aborted) timer = setTimeout(poll, events.hasMore ? 0 : 1500);
      } catch (error) {
        failure(error);
      }
    };
    if (!uuid(selected)) {
      failure(new IdentityError('CONVERSATION_NOT_FOUND', 404));
      return;
    }
    void (pendingRequest ? Promise.resolve() : load())
      .then(() => {
        if (!controller.signal.aborted) timer = setTimeout(poll, 1500);
      })
      .catch(failure);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [tenant, selected, focused, page, attempt, session.identity, context, expire, changed, pendingRequest]);
  const refresh = () => {
    setAttempt((x) => x + 1);
    changed();
  };
  useEffect(() => {
    if (data.value?.tasks.some((task) => task.sourcesUnavailable)) {
      setCitations([]);
      setBriefingOpen(false);
    }
  }, [data.value]);
  const live = useRealtime(tenant, selected);
  const scrollRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [newContent, setNewContent] = useState(false);
  useEffect(() => {
    following.current = true;
    setNewContent(false);
  }, [selected]);
  useEffect(() => {
    if (live.denied) {
      valueRef.current = undefined;
      setData({ error: live.denied });
      if (live.denied.status === 401) expire();
    }
  }, [live.denied, expire]);
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    if (following.current) node.scrollTop = node.scrollHeight;
    else setNewContent(true);
  }, [live.snapshot, data.value]);
  const activeTask = data.value?.tasks.find((t) => ['QUEUED', 'RUNNING'].includes(t.status));
  const active = !!activeTask;
  const activeLive = live.snapshot?.items.find(
    (t) => t.taskId === activeTask?.id && t.attempt === activeTask.attempt,
  );
  const ongoing =
    activeTask?.status === 'RUNNING' && activeLive?.enabled && !activeLive.stopping
      ? { id: activeTask.id, attempt: activeTask.attempt }
      : undefined;
  if (data.error)
    return (
      <section className="conversation-reader">
        <Failure error={data.error} retry={refresh} />
      </section>
    );
  if (selected && !data.value) return <Loading />;
  return (
    <LiveConversationDeck
      tenant={tenant}
      navigation={navigation}
      persistenceKey={readerKey}
      title={data.value?.conversation.title || '新会话'}
      reveal={reveal}
      onRefresh={() => {
        if (!requestNavigationLocked()) refresh();
      }}
      onClose={() => {
        if (!requestNavigationLocked()) location.hash = '#tenant=' + tenant + '&view=briefing';
      }}
      cards={[
        ...(briefingContext && briefingOpen
          ? [
              {
                id: 'briefing',
                kind: 'source' as const,
                title: briefingTitle || '画报卡片',
                label: '画报卡片',
                close: () => setBriefingOpen(false),
                content: (
                  <TaskReadingBody
                    tenant={tenant}
                    task={briefingContext}
                    onSource={openCitation}
                    onTitle={setBriefingTitle}
                  />
                ),
              },
            ]
          : []),
        ...citations.flatMap((c) => [
          {
            id: c.id,
            kind: 'file' as const,
            title: c.title,
            label: '资料来源 ' + c.title,
            actions: (
              <IconButton
                icon={Info}
                label={'查看资料属性 ' + c.title}
                onClick={() => {
                  setProperties((all) => (all.includes(c.id) ? all : [...all, c.id]));
                  setReveal((previous) => ({
                    id: 'properties:' + c.id,
                    sequence: (previous?.sequence || 0) + 1,
                  }));
                }}
              />
            ),
            close: () => {
              setCitations((all) => all.filter((item) => item.id !== c.id));
              setProperties((all) => all.filter((id) => id !== c.id));
            },
            content: <Citation tenant={tenant} id={c.id} verification={context} embedded back={() => {}} />,
          },
          ...(properties.includes(c.id)
            ? [
                {
                  id: 'properties:' + c.id,
                  parentId: c.id,
                  kind: 'properties' as const,
                  title: c.title,
                  label: '资料属性 ' + c.title,
                  close: () => setProperties((all) => all.filter((id) => id !== c.id)),
                  content: (
                    <Citation
                      tenant={tenant}
                      id={c.id}
                      verification={context}
                      embedded
                      propertiesOnly
                      back={() => {}}
                    />
                  ),
                },
              ]
            : []),
        ]),
      ]}
    >
      <section className={`conversation-reader ${!selected ? 'is-new-conversation' : ''}`}>
        <header className="deck-card-header live-card-heading">
          <div>
            <h2>{data.value?.conversation.title || '新会话'}</h2>
            {agentMode !== 'live' && (
              <p className="muted">
                {agentMode === 'off'
                  ? '模型暂不可用 · 任务可保存等待'
                  : agentMode === 'verification'
                    ? '联调验证 · 未调用真实模型'
                    : '描述需求，让 AI 协助完成工作'}
              </p>
            )}
          </div>
        </header>
        <div
          ref={scrollRef}
          className="conversation-messages"
          data-scroll-key="messages"
          onScroll={(e) => {
            const n = e.currentTarget;
            following.current = n.scrollHeight - n.scrollTop - n.clientHeight < 48;
            if (following.current) setNewContent(false);
          }}
        >
          {live.disconnected && <p role="status">连接恢复中，已显示内容仍保留</p>}
          {data.value?.tasks.map((task) => (
            <TaskCard
              key={task.id}
              tenant={tenant}
              conversation={selected!}
              task={task}
              live={live.snapshot?.items.find((t) => t.taskId === task.id && t.attempt === task.attempt)}
              changed={refresh}
              citation={(id) => {
                const source = task.sources.find((s) => s.id === id);
                if (source) openCitation(id, source.filename + ' · v' + source.version);
              }}
            />
          ))}
          {!data.value && (
            <section className="conversation-intro" aria-label="新会话启动建议">
              <h3>从一件具体的工作开始</h3>
              <p>选一个方向，或直接写下你想完成的事。</p>
              <div className="live-starter-grid">
                {[
                  {
                    title: '整理资料',
                    description: '提炼结论，找出待确认的问题',
                    icon: Files,
                    text: '请整理所选范围内的相关资料，提炼关键结论、依据和待确认的问题。',
                  },
                  {
                    title: '起草方案',
                    description: '明确需求，形成可讨论的初稿',
                    icon: FileText,
                    text: '请协助起草一份工作方案，先确认目标、需求和交付范围。',
                  },
                  {
                    title: '分析问题',
                    description: '结合资料，梳理原因与建议',
                    icon: Search,
                    text: '请结合可用资料分析当前问题，区分已有依据与需要核实的判断。',
                  },
                  {
                    title: '规划下一步',
                    description: '拆解目标，理清行动与优先级',
                    icon: ListChecks,
                    text: '请帮我拆解当前工作目标，整理下一步行动、优先级和待确认项。',
                  },
                ].map(({ title, description, icon: Icon, text }) => (
                  <button
                    type="button"
                    key={title}
                    disabled={pendingRequest}
                    onClick={() =>
                      setSuggestion({
                        text,
                        sequence: (suggestion?.sequence || 0) + 1,
                      })
                    }
                  >
                    <Icon size={20} strokeWidth={1.6} />
                    <strong>{title}</strong>
                    <span>{description}</span>
                  </button>
                ))}
              </div>
              <div className="live-inline-suggestions" aria-label="提示词建议">
                <small>也可以这样开始</small>
                {['总结一份资料', '准备一份周报', '规划下一步'].map((text) => (
                  <button
                    type="button"
                    key={text}
                    onClick={() => setSuggestion({ text, sequence: (suggestion?.sequence || 0) + 1 })}
                  >
                    {text}
                  </button>
                ))}
              </div>
              <p className="live-intro-capability">
                {agentMode === 'off'
                  ? '模型暂不可用。你可以先写下需求，发送后保存为等待中的任务。'
                  : agentMode === 'verification'
                    ? '联调任务可使用所选范围内已解析的资料片段，也可指定文件版本供工具处理。'
                    : 'AI 任务可检索所选范围内已解析的资料片段，再生成回复。'}
                {agentMode !== 'off' && publicWebEnabled && '也可查找你指定的公开内容。'}
              </p>
            </section>
          )}
          {data.value && !focused && (page > 0 || data.value.hasMore) && (
            <Pager
              page={page}
              next={data.value.hasMore}
              onPage={(next) => {
                if (!pendingRequest) setPage(next);
              }}
            />
          )}
        </div>
        {newContent && (
          <Button
            className="conversation-new-content"
            onClick={() => {
              following.current = true;
              setNewContent(false);
              if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            }}
          >
            有新内容 ↓
          </Button>
        )}
        {focused ? (
          <p className="conversation-history-note">
            正在查看指定任务及其当前状态。
            <Button
              onClick={() => {
                location.hash = retainConversationContext(conversationHref(tenant, selected), location.hash);
              }}
            >
              返回最新对话并继续
            </Button>
          </p>
        ) : (
          <ConversationComposer
            suggestion={suggestion}
            tenant={tenant}
            selected={selected}
            space={data.value?.conversation.workspaceId}
            context={context}
            ongoing={ongoing}
            enabled={enabled && (!active || !!ongoing) && page === 0 && !pendingRequest}
            agentMode={agentMode}
            publicWebEnabled={publicWebEnabled}
            disabledReason={
              pendingRequest
                ? '请先完成本次评价提交的核对。'
                : !enabled
                  ? '会话暂未开放。'
                  : active && !ongoing
                    ? activeLive?.stopping
                      ? '正在停止任务…'
                      : '正在准备执行，可先编辑补充。'
                    : page !== 0
                      ? '返回最新记录后可继续发送。'
                      : ''
            }
            changed={refresh}
          />
        )}
      </section>
    </LiveConversationDeck>
  );
}
const labels: Record<string, string> = {
  QUEUED: '等待执行',
  RUNNING: '正在查找资料',
  SUCCEEDED: '执行完成',
  FAILED: '执行未完成',
  CANCELLED: '已取消',
  INTERRUPTED: '执行中断',
  PAUSED: '已暂停',
  WAITING_INPUT: '等待补充信息',
  WAITING_CAPABILITY: '等待所需能力',
  PARTIAL: '部分完成',
  RESULT_UNKNOWN: '执行结果待核对',
};
function TaskCard({
  tenant,
  conversation,
  task,
  live,
  changed,
  citation,
}: {
  tenant: string;
  conversation: string;
  task: ConversationTask;
  live?: LiveTask;
  changed: () => void;
  citation: (id: string) => void;
}) {
  const [readingOriginal, setReadingOriginal] = useState<TaskOriginal>();
  const { expire } = useSession();
  const pendingRequest = useContext(RequestPending);
  const downloadController = useRef<AbortController | null>(null);
  useEffect(() => () => downloadController.current?.abort(), []);
  const [downloadError, setDownloadError] = useState<unknown>();
  const [downloading, setDownloading] = useState(false);
  const submit = useSubmission<{ expectedRevision: number; action: TaskAction; input?: string }>();
  useRequestLock(submit.busy || submit.uncertain);
  const [submittedAction, setSubmittedAction] = useState<TaskAction>();
  const [input, setInput] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const actions: { action: TaskAction; label: string }[] = [];
  if (!task.sourcesUnavailable && task.reconciliationRequired)
    actions.push({ action: 'RECONCILE', label: '核对执行影响' });
  else if (
    !task.sourcesUnavailable &&
    ['PAUSED', 'WAITING_INPUT', 'WAITING_CAPABILITY', 'PARTIAL'].includes(task.status)
  )
    actions.push({
      action: 'RESUME',
      label: task.status === 'WAITING_INPUT' ? '提交补充并继续' : '恢复任务',
    });
  else if (!task.sourcesUnavailable && ['FAILED', 'CANCELLED', 'INTERRUPTED'].includes(task.status))
    actions.push({ action: 'RETRY', label: '重试任务' });
  if (['QUEUED', 'WAITING_INPUT', 'WAITING_CAPABILITY', 'PARTIAL'].includes(task.status))
    actions.push({ action: 'PAUSE', label: '暂停任务' });
  if (
    [
      'QUEUED',
      'RUNNING',
      'WAITING_INPUT',
      'WAITING_CAPABILITY',
      'PARTIAL',
      'PAUSED',
      'RESULT_UNKNOWN',
    ].includes(task.status)
  )
    actions.push({
      action: 'CANCEL',
      label: live?.stopping && task.status === 'RUNNING' ? '正在停止…' : '停止任务',
    });
  return (
    <article className="conversation-turn">
      <p className="conversation-user">{task.prompt}</p>
      <div className="conversation-result">
        <div className="live-answer-heading">
          <span className="live-answer-avatar">{task.mode === 'AGENT' ? 'AI' : <Search size={16} />}</span>
          <strong>
            {live?.stopping && task.status === 'RUNNING'
              ? '正在停止…'
              : task.mode === 'AGENT' && task.status === 'RUNNING'
                ? '正在执行任务'
                : task.mode === 'AGENT' && task.status === 'SUCCEEDED'
                  ? '本次处理完成'
                  : labels[task.status]}
          </strong>
          {task.mode === 'AGENT' && (
            <Badge>{task.executionClass === 'verification' ? '联调验证 · 未调用真实模型' : 'AI 任务'}</Badge>
          )}
        </div>
        {live && !task.sourcesUnavailable && (
          <LiveProcess
            live={live}
            task={task}
            tenant={tenant}
            conversation={conversation}
            changed={changed}
          />
        )}
        {task.reply && (
          <div className="conversation-reply">
            <DocumentText text={task.reply} />
          </div>
        )}
        {task.mode === 'AGENT' && !task.sourcesUnavailable && (
          <TaskWorkNotices tenant={tenant} task={task.id} verification={task.revision} />
        )}
        {task.mode === 'AGENT' && task.status === 'SUCCEEDED' && task.reply && (
          <SaveAsDocument tenant={tenant} conversation={conversation} task={task.id} />
        )}
        {task.status === 'SUCCEEDED' &&
          task.artifacts
            .filter((file) => /\.(txt|md)$/i.test(file.filename))
            .map((file) => (
              <SaveAsDocument
                key={file.id}
                tenant={tenant}
                conversation={conversation}
                task={task.id}
                artifact={file.id}
                label={'编辑 ' + file.filename}
              />
            ))}
        {task.mode === 'SOURCE_LOOKUP' && task.status === 'SUCCEEDED' && (
          <p>
            {task.sourcesUnavailable
              ? '部分来源已不可访问。'
              : task.summaryCode === 'NO_SOURCES'
                ? '没有找到匹配的已解析资料。可以换一个关键词，或先在资料库检查解析状态。'
                : '以下是匹配的资料来源；未进行 AI 总结。'}
          </p>
        )}
        {task.errorCode && <p className="access-alert">{taskErrorMessage(task.errorCode)}</p>}
        {readingOriginal && (
          <AttachmentReader
            tenant={tenant}
            file={readingOriginal}
            conversation={readingOriginal.attachmentConversationId || undefined}
            close={() => setReadingOriginal(undefined)}
          />
        )}
        {task.originals.length > 0 && (
          <div className="conversation-originals" aria-label="本次指定的原件">
            {task.originals.map((file) => (
              <p key={file.versionId}>
                <Button variant="ghost" onClick={() => setReadingOriginal(file)}>
                  {file.filename} · v{file.version}
                </Button>
                <span>
                  {file.read
                    ? '已读取原件'
                    : task.sources.some((source) => source.versionId === file.versionId)
                      ? '已读取解析内容'
                      : '已选用'}
                </span>
              </p>
            ))}
          </div>
        )}
        {task.publicQuery && <p className="muted">公开检索内容：{task.publicQuery}</p>}
        {task.webSources.length > 0 && (
          <div className="conversation-web-sources" aria-label="公开网页来源">
            {task.webSources.map((source) => (
              <details key={source.id}>
                <summary>
                  {source.title} · {source.kind === 'PAGE' ? '已读取页面' : '检索线索 · 未读取页面'}
                </summary>
                <a href={source.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
                  打开公开来源
                </a>
                <p>{source.excerpt}</p>
                <small>
                  {new Date(source.retrievedAt).toLocaleString()} ·{' '}
                  {source.truncated ? '内容已截取' : '本次获取的文本快照'}
                </small>
              </details>
            ))}
          </div>
        )}
        {task.skills.length > 0 && (
          <details className="conversation-skills">
            <summary>本次使用的能力</summary>
            {task.skills.map((skill) => (
              <p key={skill.id}>
                {skill.id === 'public-research'
                  ? '公开资料研究'
                  : skill.id === 'candidate-trials'
                    ? '候选工具隔离试验'
                    : skill.id === 'source-review'
                      ? '资料核对'
                      : skill.id}{' '}
                · v{skill.version}
              </p>
            ))}
          </details>
        )}
        {task.artifacts.map((file) => (
          <Button
            key={file.id}
            disabled={downloading}
            onClick={async () => {
              const controller = new AbortController();
              downloadController.current = controller;
              setDownloading(true);
              setDownloadError(undefined);
              try {
                const blob = await api.download(tenant, conversation, task.id, file, controller.signal);
                if (controller.signal.aborted) return;
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = file.filename;
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              } catch (error) {
                if (controller.signal.aborted) return;
                setDownloadError(error);
                if (error instanceof IdentityError && error.status === 401) expire();
              } finally {
                if (!controller.signal.aborted) setDownloading(false);
              }
            }}
          >
            下载 {file.filename}
          </Button>
        ))}
        <SubmitError error={downloadError} uncertain={false} />
        <div className="conversation-sources">
          {task.sources.map((s) => (
            <button key={s.id} onClick={() => citation(s.id)}>
              <strong>
                {s.filename} · v{s.version}
              </strong>
              <small>
                {s.locator}
                {s.method === 'OCR' ? ' · OCR 需核对' : ''}
              </small>
              <span>{s.content.slice(0, 220)}</span>
            </button>
          ))}
        </div>
        {task.requiredInput && !live?.questions.length && <p>{task.requiredInput}</p>}
        {task.status === 'WAITING_CAPABILITY' && (
          <p className="muted">任务已保存，当前没有可用执行能力；不会自动反复调用。能力恢复后可继续。</p>
        )}
        {task.reconciliationRequired && (
          <p className="access-alert">
            回执不足，尚不能确认结果。系统只会依据已记录的工具范围核对是否可安全重试。
          </p>
        )}
        {!live?.questions.some((q) => !q.answered) &&
          task.mode === 'AGENT' &&
          actions.some((a) => ['RESUME', 'RETRY'].includes(a.action)) && (
            <Field label="补充本任务（可选）">
              <textarea
                aria-label="补充本任务（可选）"
                disabled={pendingRequest || submit.busy || submit.uncertain}
                maxLength={2000}
                rows={2}
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
            </Field>
          )}
        <div className="conversation-task-actions">
          {actions
            .filter((a) => !(a.action === 'RESUME' && live?.questions.some((q) => q.blocking && !q.answered)))
            .map(({ action, label }) => (
              <Button
                key={action}
                disabled={
                  (task.status === 'RUNNING' && live?.stopping) ||
                  (pendingRequest && !submit.uncertain) ||
                  submit.busy ||
                  (submit.uncertain && action !== submittedAction) ||
                  (task.status === 'WAITING_INPUT' && action === 'RESUME' && !input.trim())
                }
                onClick={() => {
                  if (!submit.uncertain) setSubmittedAction(action);
                  void submit.submit(
                    {
                      expectedRevision: task.revision,
                      action,
                      ...(input.trim() && ['RESUME', 'RETRY'].includes(action)
                        ? { input: input.trim() }
                        : {}),
                    },
                    async (body, requestId) => {
                      await api.action(tenant, conversation, task.id, { ...body, requestId });
                      setInput('');
                      changed();
                    },
                  );
                }}
              >
                {submit.uncertain && action === submittedAction ? '重试本次操作' : label}
              </Button>
            ))}
          {!task.sourcesUnavailable && task.attempt > 0 && (
            <Button variant="ghost" onClick={() => setHistoryOpen(!historyOpen)}>
              {historyOpen ? '收起执行历史' : '查看执行历史'}
            </Button>
          )}
        </div>
        {!task.sourcesUnavailable &&
          ['SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED', 'INTERRUPTED', 'RESULT_UNKNOWN'].includes(
            task.status,
          ) && (
            <FeedbackPanel
              tenant={tenant}
              target={{
                kind: 'TASK',
                taskId: task.id,
                taskRevision: task.revision,
                attempt: task.attempt,
                presentationVersion: 'task-v1',
                presentationRevision: 0,
              }}
              onOpenConversation={(id) => {
                location.hash = retainConversationContext(conversationHref(tenant, id), location.hash);
              }}
            />
          )}
        {!task.sourcesUnavailable && historyOpen && (
          <AttemptHistory
            tenant={tenant}
            conversation={conversation}
            task={task.id}
            revision={task.revision}
          />
        )}
        {submit.error instanceof IdentityError &&
        (submit.error.code.startsWith('TASK_') || submit.error.code === 'CONVERSATION_BUSY') ? (
          <p role="alert" className="access-alert">
            {taskErrorMessage(submit.error.code)}
          </p>
        ) : (
          <SubmitError error={submit.error} uncertain={submit.uncertain} />
        )}
      </div>
    </article>
  );
}
function AttemptHistory({
  tenant,
  conversation,
  task,
  revision,
}: {
  tenant: string;
  conversation: string;
  task: string;
  revision: number;
}) {
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [downloadError, setDownloadError] = useState<unknown>();
  const download = useRef<AbortController | null>(null);
  useEffect(() => () => download.current?.abort(), []);
  const history = useRemote(
    (signal) => api.attempts(tenant, conversation, task, page * 10, signal),
    [tenant, conversation, task, page, revision, refresh],
  );
  if (!history.value)
    return history.error ? (
      <Failure error={history.error} retry={() => setRefresh(refresh + 1)} />
    ) : (
      <Loading />
    );
  return (
    <section className="conversation-attempts" aria-label="执行历史">
      {history.value.items.map((a) => (
        <details key={a.number}>
          <summary>
            第 {a.number} 次执行 · {labels[a.status]}
            {a.provenance === 'LEGACY_CURRENT_ONLY' ? ' · 旧记录仅保留当次事实' : ''}
          </summary>
          <p className="muted">
            {a.startedAt ? new Date(a.startedAt).toLocaleString() : '开始时间未知'}
            {a.finishedAt ? ' — ' + new Date(a.finishedAt).toLocaleString() : ''}
          </p>
          <p className="conversation-reply">{a.input}</p>
          {a.reply && <p className="conversation-reply">{a.reply}</p>}
          {a.errorCode && <p>{taskErrorMessage(a.errorCode)}</p>}
          {a.tools.map((t) => (
            <p key={t.callId}>
              {t.name} ·{' '}
              {t.status === 'succeeded' ? '工具已返回' : t.status === 'failed' ? '工具失败' : '结果未收到'}
            </p>
          ))}
          {a.sources.map((source) => (
            <p key={source.id}>
              {source.filename} · v{source.version} · {source.locator}
            </p>
          ))}
          {a.artifacts.map((file) => (
            <Button
              key={file.id}
              onClick={async () => {
                download.current?.abort();
                const controller = new AbortController();
                download.current = controller;
                setDownloadError(undefined);
                try {
                  const blob = await api.download(tenant, conversation, task, file, controller.signal);
                  if (controller.signal.aborted) return;
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = file.filename;
                  link.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                } catch (error) {
                  if (!controller.signal.aborted) setDownloadError(error);
                }
              }}
            >
              下载 {file.filename}
            </Button>
          ))}
          {a.reconciliationCode && <p>已核对：允许工具不包含业务写入，可重新尝试；原结果仍未确认。</p>}
        </details>
      ))}
      <SubmitError error={downloadError} uncertain={false} />
      <Button disabled={page === 0} onClick={() => setPage(page - 1)}>
        上一页
      </Button>
      <Button disabled={!history.value.hasMore} onClick={() => setPage(page + 1)}>
        更早的执行
      </Button>
    </section>
  );
}
type PendingSend = SendTask & { liveTask?: string; liveAttempt?: number };
export function ConversationComposer({
  ongoing,
  suggestion,
  fromBriefing = false,
  tenant,
  selected,
  space,
  context,
  enabled,
  agentMode,
  publicWebEnabled,
  disabledReason,
  changed,
}: {
  tenant: string;
  selected?: string;
  space?: string;
  context: TenantContext;
  enabled: boolean;
  agentMode: ConversationPage['agentMode'];
  publicWebEnabled: boolean;
  disabledReason: string;
  changed: () => void;
  suggestion?: { text: string; sequence: number };
  fromBriefing?: boolean;
  ongoing?: { id: string; attempt: number };
}) {
  const { session, expire } = useSession();
  const pendingRequest = useContext(RequestPending);
  const key = `dreamcore:composer:${session.identity?.account.id}:${tenant}:${selected || 'new'}`;
  const [loaded] = useState(() => readTabDraft(key));
  const initial = useRef(record(loaded.value) ? loaded.value : {});
  const [stored, setStored] = useState(!loaded.unreadable);
  // New sends always use AI. Uncertain historical sends retain their exact body below.
  const mode: SendTask['mode'] = 'AGENT';
  const [publicQuery, setPublicQuery] = useState(
    typeof initial.current.publicQuery === 'string' ? initial.current.publicQuery : '',
  );
  const [text, setText] = useState(typeof initial.current.text === 'string' ? initial.current.text : '');
  const [location, setLocation] = useState(
    space ||
      (typeof initial.current.space === 'string'
        ? initial.current.space
        : context.workspaces.find((s) => s.kind === 'PERSONAL')?.id || ''),
  );
  const [originals, setOriginals] = useState<TaskOriginal[]>(
    Array.isArray(initial.current.originals) ? initial.current.originals.filter(isOriginal).slice(0, 3) : [],
  );
  const [draftConversation, setDraftConversation] = useState<string | undefined>(
    typeof initial.current.draftConversation === 'string' ? initial.current.draftConversation : undefined,
  );
  const [draftRequestId] = useState(
    typeof initial.current.draftRequestId === 'string' ? initial.current.draftRequestId : crypto.randomUUID(),
  );
  const [uploading, setUploading] = useState(false);
  const [prepared, setPrepared] = useState<Record<string, boolean>>({});
  const onReady = useCallback(
    (id: string, ready: boolean) =>
      setPrepared((previous) => (previous[id] === ready ? previous : { ...previous, [id]: ready })),
    [],
  );
  const [dropped, setDropped] = useState<{ files: File[]; sequence: number }>();
  const [selectedOnly, setSelectedOnly] = useState(initial.current.selectedOnly === true);
  const preparing = uploading || originals.some((f) => f.workspaceId && !prepared[f.versionId]);
  const restored = initial.current.pending;
  const [pending, setPending] = useState<PendingSend | undefined>(
    record(restored) &&
      uuid(restored.requestId) &&
      uuid(restored.workspaceId) &&
      typeof restored.prompt === 'string' &&
      ['SOURCE_LOOKUP', 'AGENT'].includes(String(restored.mode))
      ? (restored as unknown as PendingSend)
      : undefined,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const composing = useRef(false);
  const submitting = useRef(false);
  const [focused, setFocused] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const expanded = !fromBriefing || focused || !!text || !!originals.length || !!pending;
  const isCollapsed = fromBriefing && collapsed && !expanded;
  useEffect(() => {
    if (!fromBriefing) return;
    const scroll = form.current?.closest('.access-main')?.querySelector('.access-content');
    if (!scroll) return;
    let origin = scroll.scrollTop;
    const onScroll = () => {
      const top = scroll.scrollTop;
      if (expanded || top < 40 || top < origin - 36) {
        setCollapsed(false);
        origin = top;
      } else if (top > origin + 60) {
        setCollapsed(true);
        origin = top;
      }
    };
    scroll.addEventListener('scroll', onScroll, { passive: true });
    return () => scroll.removeEventListener('scroll', onScroll);
  }, [fromBriefing, expanded]);
  const controller = useRef<AbortController | null>(null);
  const toolsAnchor = useRef<HTMLDivElement>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  useEffect(() => {
    const focus = initial.current.focus;
    if (!record(focus) || !textarea.current || pending) return;
    const node = textarea.current;
    node.focus({ preventScroll: true });
    node.setSelectionRange(
      Number(focus.start) || 0,
      Number(focus.end) || 0,
      focus.direction === 'backward' ? 'backward' : focus.direction === 'forward' ? 'forward' : 'none',
    );
    delete initial.current.focus;
  }, []);
  useEffect(() => {
    if (!textarea.current) return;
    textarea.current.style.height = 'auto';
    textarea.current.style.height =
      Math.min(160, Math.max(fromBriefing ? (expanded ? 68 : 54) : 70, textarea.current.scrollHeight)) + 'px';
  }, [text, expanded, fromBriefing]);
  useEffect(() => {
    if (!suggestion || busy || pending) return;
    setText(suggestion.text);
    textarea.current?.focus({ preventScroll: true });
  }, [suggestion]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    setStored(
      writeTabDraft(key, {
        text,
        mode,
        publicQuery,
        space: location,
        originals,
        pending,
        draftConversation,
        draftRequestId,
        selectedOnly,
      }),
    );
  }, [
    key,
    text,
    mode,
    publicQuery,
    location,
    originals,
    pending,
    draftConversation,
    draftRequestId,
    selectedOnly,
  ]);
  const allowed = context.workspaces.some((s) => s.id === (space || location));
  return (
    <form
      ref={form}
      className={`conversation-composer ${fromBriefing ? 'workspace-composer' : ''} ${expanded ? 'is-expanded' : ''} ${isCollapsed ? 'is-collapsed' : ''}`}
      aria-label={fromBriefing ? '从画报发起会话' : undefined}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length) {
          e.preventDefault();
          if (!busy && !pending && !ongoing)
            setDropped({ files: Array.from(e.dataTransfer.files), sequence: Date.now() });
        }
      }}
      onSubmit={async (event) => {
        event.preventDefault();
        if (
          submitting.current ||
          composing.current ||
          busy ||
          preparing ||
          !enabled ||
          !allowed ||
          (!pending && !text.trim())
        )
          return;
        const body = pending || {
          requestId: crypto.randomUUID(),
          ...(ongoing ? { liveTask: ongoing.id, liveAttempt: ongoing.attempt } : {}),
          workspaceId: space || location,
          prompt: text.trim(),
          mode,
          sourceScope:
            selectedOnly && originals.length ? ('SELECTED' as const) : ('AUTHORIZED_LIBRARY' as const),
          ...(mode === 'AGENT' && originals.length
            ? { originals: originals.map(({ materialId, versionId }) => ({ materialId, versionId })) }
            : {}),
          ...(mode === 'AGENT' && !selectedOnly && publicWebEnabled && publicQuery.trim()
            ? { publicQuery: publicQuery.trim() }
            : {}),
        };
        setStored(
          writeTabDraft(key, {
            text,
            mode,
            publicQuery,
            space: location,
            originals,
            pending: body,
            draftConversation,
            draftRequestId,
            selectedOnly,
          }),
        );
        setPending(body);
        submitting.current = true;
        setBusy(true);
        setError(undefined);
        const request = new AbortController();
        controller.current = request;
        try {
          if (body.liveTask && selected && body.liveAttempt) {
            await liveClient.input(
              tenant,
              selected,
              body.liveTask,
              { requestId: body.requestId, attempt: body.liveAttempt, text: body.prompt },
              request.signal,
            );
            if (request.signal.aborted) return;
            setText('');
            setPending(undefined);
            setStored(removeTabDraft(key));
            changed();
            return;
          }
          const { liveTask: _task, liveAttempt: _attempt, ...sendBody } = body;
          const result = await api.send(tenant, selected || draftConversation, sendBody, request.signal);
          if (request.signal.aborted) return;
          setText('');
          setPublicQuery('');
          setOriginals([]);
          setPending(undefined);
          setStored(removeTabDraft(key));
          if (fromBriefing && form.current) prepareViewportMotion(tenant, form.current, 'composer');
          locationHash(result.conversation.id);
          changed();
        } catch (e) {
          if (request.signal.aborted) return;
          setError(e);
          if (e instanceof IdentityError && e.status >= 400 && e.status < 500) {
            setPending(undefined);
            if (e.status === 401) expire();
          }
        } finally {
          submitting.current = false;
          if (!request.signal.aborted) setBusy(false);
        }
      }}
    >
      {isCollapsed && (
        <button
          type="button"
          className="workspace-compose-trigger"
          aria-label="新建会话"
          onClick={() => {
            setCollapsed(false);
            requestAnimationFrame(() => textarea.current?.focus({ preventScroll: true }));
          }}
        >
          <Plus size={22} />
        </button>
      )}
      <div className="live-composer-surface" hidden={isCollapsed}>
        <fieldset disabled={busy || !!pending}>
          <div className="live-composer-input">
            <Field label={mode === 'AGENT' ? '工作要求' : '资料关键词'}>
              <textarea
                ref={textarea}
                aria-label={
                  ongoing
                    ? '补充要求'
                    : fromBriefing
                      ? '新的工作需求'
                      : mode === 'AGENT'
                        ? '工作要求'
                        : '资料关键词'
                }
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    !event.shiftKey &&
                    !composing.current &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    if (text.trim()) event.currentTarget.form?.requestSubmit();
                  }
                }}
                onCompositionStart={() => {
                  composing.current = true;
                }}
                onCompositionEnd={() => {
                  composing.current = false;
                }}
                required
                maxLength={mode === 'AGENT' ? 2000 : 200}
                rows={3}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={ongoing ? '补充要求，AI 将在后续步骤采用' : '有什么工作想交给 AI？'}
              />
            </Field>
          </div>
          <div className="live-composer-tools">
            {!ongoing && (
            <AttachmentMaterials
              tenant={tenant}
              conversation={selected || draftConversation}
              draftRequestId={draftRequestId}
              context={context}
              files={originals}
              setFiles={setOriginals}
              onConversation={setDraftConversation}
              onBusy={setUploading}
              onReady={onReady}
              dropped={dropped}
              verification={agentMode === 'verification'}
            />
            )}
          </div>
          {originals.length > 0 && (
            <label className="attachment-scope">
              <input
                type="checkbox"
                checked={selectedOnly}
                onChange={(e) => setSelectedOnly(e.target.checked)}
              />
              只用所选资料
            </label>
          )}
          {!ongoing && mode === 'AGENT' && !selectedOnly && publicWebEnabled && (
            <details className="live-web-options">
              <summary>查找公开资料（可选）</summary>
              <Field label="公开检索内容（可选）">
                <input
                  aria-label="公开检索内容（可选）"
                  value={publicQuery}
                  maxLength={2048}
                  pattern="([hH][tT][tT][pP][sS]://.*|.{0,200})"
                  title="公开关键词最多 200 字，HTTPS 网址最多 2048 字"
                  onChange={(e) => setPublicQuery(e.target.value)}
                  placeholder="公开关键词，或一个 https 网页地址"
                />
                <small>仅将这里填写的内容用于外部检索或访问；请勿填写企业机密。留空则不联网查找。</small>
              </Field>
            </details>
          )}
        </fieldset>
        <Button
          icon={ArrowUp}
          className="live-composer-submit"
          type="submit"
          variant="primary"
          aria-label={
            busy
              ? '提交中…'
              : pending
                ? '重试上次发送'
                : fromBriefing
                  ? '发送消息'
                  : mode === 'AGENT'
                    ? ongoing
                      ? '发送补充'
                      : '开始任务'
                    : '查找资料'
          }
          title={
            busy
              ? '提交中…'
              : pending
                ? '重试上次发送'
                : fromBriefing
                  ? '发送消息'
                  : mode === 'AGENT'
                    ? ongoing
                      ? '发送补充'
                      : '开始任务'
                    : '查找资料'
          }
          disabled={busy || preparing || !enabled || !allowed || !text.trim()}
        >
          <span className="live-visually-hidden">
            {busy
              ? '提交中…'
              : pending
                ? '重试上次发送'
                : fromBriefing
                  ? '发送消息'
                  : mode === 'AGENT'
                    ? ongoing
                      ? '发送补充'
                      : '开始任务'
                    : '查找资料'}
          </span>
        </Button>
      </div>
      {mode === 'AGENT' && agentMode === 'off' && (
        <p className="muted">模型暂不可用。发送后会保存任务，等待模型恢复；不会生成 AI 回复。</p>
      )}
      {(preparing || disabledReason) && (
        <div className="conversation-send">
          <small>{preparing ? '资料准备中，可先编辑问题' : disabledReason}</small>
        </div>
      )}
      <DraftWarning unavailable={!stored} unreadable={loaded.unreadable} pending={!!pending} />
      <SubmitError error={error} uncertain={!!pending && !busy} />
    </form>
  );
  function locationHash(id: string) {
    window.location.hash = fromBriefing
      ? conversationHref(tenant, id) + '&from=briefing'
      : retainConversationContext(conversationHref(tenant, id), window.location.hash);
  }
}

import { PresentationDraft } from './PresentationDraft';
import { presentationClient } from './presentation-client';
import type { PresentationOptions } from '../../contracts/public-api/presentation';
import { LiveReply, ReplyProgress } from './LiveReply';
import { ReplyText } from './ReplyText';
import { CardTypeTag } from './CardTypeTag';
import { ReplyReferences } from './ReplyReferences';
import { ConversationRow } from './ConversationRow';
import { useConversationReadReceipt } from './useConversationReadReceipt';
import { useConversationScroll } from './useConversationScroll';
import { useLiveAnswers, type LiveAnswer } from './useLiveAnswers';
import { useComposerHeight } from './useComposerHeight';
import { TaskInterventionCard } from './TaskInterventionCard';
import { TaskSendControl } from './TaskSendControl';
import { DreamcoreLogo } from '../components/DreamcoreLogo';
import { useConversationList, ConversationListTail } from './useConversationList';
import { useViewState } from '../shared/useViewState';
import { ReplyFeedback } from './ReplyFeedback';
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
  Globe,
  Copy,
  Check,
  History,
  MoreHorizontal,
  ArrowUp,
  FileText,
  Files,
  Folder,
  ListChecks,
  Plus,
  Paperclip,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  ChevronLeft,
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
import { TaskReadingBody, type ReadingTask, type ReadingHeader } from '../briefing-live/TaskReadingBody';
import { briefingConversationHref, readBriefingContext, retainConversationContext } from './briefing-context';
import { ReadingDialog } from '../briefing-live/ReadingDialog';
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
  const { session } = useSession();
  const pendingRequest = useContext(RequestPending);
  const [contextAttempt, setContextAttempt] = useState(0);
  const [hash, setHash] = useState(location.hash),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const change = () => {
      if (!requestNavigationLocked()) setHash(location.hash);
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  const [removedSelection, setRemovedSelection] = useState<{ tenant: string; id: string }>();
  const selected = new URLSearchParams(hash.slice(1)).get('conversation') || undefined;
  useEffect(() => {
    if (!removedSelection || pendingRequest || requestNavigationLocked()) return;
    setRemovedSelection(undefined);
    if (removedSelection.tenant === tenant && removedSelection.id === selected)
      location.hash = conversationHref(tenant);
  }, [removedSelection, pendingRequest, tenant, selected]);
  const focused = new URLSearchParams(hash.slice(1)).get('task') || undefined;
  const context = useRemote(
    (signal) => identityClient.context(tenant, signal),
    [tenant, session.identity, contextAttempt],
  );
  const list = useConversationList(tenant, attempt);
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
          key={tenant}
          selectedTitle={list.value.items.find((item) => item.id === selected)?.title}
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
                </header>
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
                        <ConversationRow
                          key={c.id}
                          tenant={tenant}
                          item={c}
                          selected={selected === c.id}
                          href={retainConversationContext(conversationHref(tenant, c.id), hash)}
                          changed={() => {
                            setRemovedSelection({ tenant, id: c.id });
                            changed();
                          }}
                        />
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
                        <ConversationRow
                          key={c.id}
                          tenant={tenant}
                          item={c}
                          selected={selected === c.id}
                          href={retainConversationContext(conversationHref(tenant, c.id), hash)}
                          changed={() => {
                            setRemovedSelection({ tenant, id: c.id });
                            changed();
                          }}
                        />
                      ))}
                  </section>
                )}
                {!list.value.items.length && (
                  <p className="live-list-empty">从一件具体的工作开始。发送后，会话会保存在这里。</p>
                )}
                <ConversationListTail
                  hasMore={list.value.hasMore}
                  loading={list.loading}
                  error={list.moreError}
                  blocked={pendingRequest}
                  loadMore={list.loadMore}
                />
              </div>
            </nav>
          }
        />
      )}
    </>
  );
}
function ConversationView({
  selectedTitle,
  tenant,
  selected,
  focused,
  context,
  enabled,
  agentMode,
  publicWebEnabled,
  changed,
  navigation,
  briefingContext: linkedBriefing,
}: {
  selectedTitle?: string;
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
  const sessionKey = JSON.stringify([
    selected,
    focused,
    linkedBriefing?.taskId,
    linkedBriefing?.taskRevision,
    linkedBriefing?.attempt,
  ]);
  const [sessionKeySeen, setSessionKeySeen] = useState(sessionKey);
  const [data, setData] = useState<{ value?: ConversationDetail; error?: unknown }>({});
  const sourceContext = data.value?.briefingContext || linkedBriefing;
  const briefingContext =
    sourceContext &&
    linkedBriefing?.presentation &&
    sourceContext.taskId === linkedBriefing.taskId &&
    sourceContext.taskRevision === linkedBriefing.taskRevision &&
    sourceContext.attempt === linkedBriefing.attempt &&
    sourceContext.conversationId === linkedBriefing.conversationId
      ? { ...sourceContext, presentation: linkedBriefing.presentation }
      : sourceContext;
  const [attempt, setAttempt] = useState(0),
    [page, setPage] = useState(0);
  const readerKey =
    'conversation:' +
    (selected ||
      (briefingContext
        ? 'briefing:' +
          briefingContext.taskId +
          ':' +
          briefingContext.taskRevision +
          ':' +
          briefingContext.attempt
        : 'new'));
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
  const [briefingOpen, setBriefingOpen] = useState(true);
  const [briefingHeader, setBriefingHeader] = useState<ReadingHeader>();
  const briefingTitle = briefingHeader?.title;
  const [briefingReading, setBriefingReading] = useState(false);
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
      const accessDenied = error instanceof IdentityError && [401, 403, 404].includes(error.status);
      if (accessDenied || !valueRef.current) {
        valueRef.current = undefined;
        setData({ error });
      }
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
        if (events.items.length && !pendingRequest) {
          await load();
          changed();
        }
        if (!controller.signal.aborted) timer = setTimeout(poll, 1500);
      } catch (error) {
        failure(error);
        if (
          !controller.signal.aborted &&
          !(error instanceof IdentityError && [401, 403, 404].includes(error.status))
        )
          timer = setTimeout(poll, 3000);
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
  const liveDenied = useCallback(() => setAttempt((x) => x + 1), []);
  const live = useLiveAnswers(tenant, selected, liveDenied);
  const messageScroll = useConversationScroll(`${tenant}/${selected || 'new'}`, !focused && page === 0);
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
  const [responseId, setResponseId] = useViewState<string | null>(
    tenant,
    readerKey + ':response-target',
    'auto',
    (value): value is string | null => value === null || value === 'auto' || uuid(value),
  );
  const controlTask =
    !focused && page === 0
      ? data.value?.tasks.find((t) => ['QUEUED', 'RUNNING'].includes(t.status))
      : undefined;
  const latestTask = data.value?.tasks.at(-1);
  const responseTask =
    !controlTask && page === 0
      ? data.value?.tasks.find(
          (t) =>
            t.id ===
              (responseId === 'auto' && latestTask?.status === 'WAITING_INPUT'
                ? latestTask.id
                : responseId) &&
            t.status === 'WAITING_INPUT' &&
            t.waitReason !== 'PRESENTATION_CONFIRMATION',
        )
      : undefined;
  // Reset session-owned state before committing a new selection; keep the deck/list DOM mounted.
  if (sessionKeySeen !== sessionKey) {
    setSessionKeySeen(sessionKey);
    setData({});
    valueRef.current = undefined;
    setPage(0);
    setAttempt(0);
    setReveal(undefined);
    setSuggestion(undefined);
    setBriefingOpen(true);
    setBriefingHeader(undefined);
    setBriefingReading(false);
  }
  useConversationReadReceipt(
    tenant,
    sessionKeySeen === sessionKey && !focused && page === 0 && selected === data.value?.conversation.id
      ? data.value?.conversation
      : undefined,
    messageScroll.element,
    changed,
  );
  const loading = Boolean(selected && !data.value && !data.error);
  const conversationTitle =
    data.value?.conversation.title ||
    selectedTitle ||
    (selected ? '会话' : briefingContext ? briefingTitle || '画报讨论' : '新会话');
  return (
    <>
      <LiveConversationDeck
        tenant={tenant}
        navigation={navigation}
        persistenceKey={readerKey}
        title={conversationTitle}
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
                  expand: () => setBriefingReading(true),
                  content: (
                    <TaskReadingBody
                      tenant={tenant}
                      task={briefingContext}
                      onSource={openCitation}
                      onHeader={setBriefingHeader}
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
              <CardTypeTag type="会话" />
              <h2 title={conversationTitle}>{conversationTitle}</h2>
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
            className="conversation-messages"
            data-scroll-key={focused || page > 0 ? 'messages' : undefined}
            aria-live="polite"
            ref={messageScroll.ref}
          >
            {data.error ? (
              <Failure error={data.error} retry={refresh} />
            ) : loading ? (
              <Loading />
            ) : (
              <>
                {briefingContext && (
                  <section className="conversation-briefing-context" aria-label="画报讨论上下文">
                    <TaskReadingBody
                      tenant={tenant}
                      task={briefingContext}
                      preview={{
                        workspace:
                          context.workspaces.find((space) => space.id === briefingContext.workspaceId)
                            ?.name || '',
                        open: () => setBriefingOpen(true),
                      }}
                    />
                  </section>
                )}
                {data.value?.tasks.map((task) => (
                  <TaskCard
                    live={live.items.find((item) => item.taskId === task.id && item.attempt === task.attempt)}
                    reconnecting={live.reconnecting}
                    key={task.id}
                    tenant={tenant}
                    conversation={selected!}
                    task={task}
                    context={context}
                    workspaceId={data.value!.conversation.workspaceId}
                    executing={!!controlTask}
                    respond={() => {
                      setResponseId(task.id);
                      requestAnimationFrame(() =>
                        document
                          .querySelector<HTMLTextAreaElement>('.conversation-composer textarea')
                          ?.focus(),
                      );
                    }}
                    changed={refresh}
                    citation={(id) => {
                      const source = task.sources.find((s) => s.id === id);
                      if (source) openCitation(id, source.filename + ' · v' + source.version);
                    }}
                  />
                ))}
                {!data.value && !briefingContext && (
                  <section className="conversation-intro conversation-welcome" aria-label="新会话引导">
                    <DreamcoreLogo />
                    <h3>
                      有什么想法？<span>我帮你实现。</span>
                    </h3>
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
              </>
            )}
          </div>
          {focused ? (
            <p className="conversation-history-note">
              正在查看指定任务及其当前状态。
              <Button
                onClick={() => {
                  location.hash = retainConversationContext(
                    conversationHref(tenant, selected),
                    location.hash,
                  );
                }}
              >
                返回最新对话并继续
              </Button>
            </p>
          ) : (
            <ConversationComposer
              key={sessionKey}
              loading={loading || !!data.error}
              onSending={messageScroll.followLatest}
              controlTask={controlTask}
              responseTask={responseTask}
              clearResponse={() => setResponseId(null)}
              suggestion={suggestion}
              tenant={tenant}
              selected={selected}
              space={data.value?.conversation.workspaceId || briefingContext?.workspaceId}
              briefingContext={briefingContext}
              context={context}
              enabled={enabled && page === 0 && !pendingRequest}
              agentMode={agentMode}
              publicWebEnabled={publicWebEnabled}
              disabledReason={
                pendingRequest
                  ? '请先完成本次评价提交的核对。'
                  : !enabled
                    ? '会话暂未开放。'
                    : page !== 0
                      ? '返回最新记录后可继续发送。'
                      : ''
              }
              changed={refresh}
            />
          )}
        </section>
      </LiveConversationDeck>
      {briefingReading && briefingContext && (
        <ReadingDialog
          tenant={tenant}
          title={briefingTitle || '画报卡片'}
          workspace={context.workspaces.find((space) => space.id === briefingContext.workspaceId)?.name || ''}
          date={briefingHeader?.date}
          contentLabel={briefingHeader?.contentLabel}
          task={briefingContext}
          onClose={() => setBriefingReading(false)}
        />
      )}
    </>
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
  live,
  reconnecting,
  tenant,
  conversation,
  task,
  changed,
  citation,
  context,
  workspaceId,
  executing,
  respond,
}: {
  live?: LiveAnswer;
  reconnecting?: boolean;
  tenant: string;
  conversation: string;
  task: ConversationTask;
  changed: () => void;
  citation: (id: string) => void;
  context: TenantContext;
  workspaceId: string;
  executing: boolean;
  respond: () => void;
}) {
  const [readingOriginal, setReadingOriginal] = useState<TaskOriginal>();
  const { expire } = useSession();
  const [processSteps, setProcessSteps] = useState<LiveAnswer[]>([]);
  useEffect(() => {
    if (live?.state !== 'COMPLETE') return;
    setProcessSteps((old) =>
      [...old.filter((item) => item.attempt === live.attempt && item.step !== live.step), live].slice(-8),
    );
  }, [live?.attempt, live?.step, live?.version]);
  const retainedProcess = processSteps.filter(
    (item) => task.reply && item.text.trim() !== task.reply.trim() && !task.reply.includes(item.text.trim()),
  );
  const pendingRequest = useContext(RequestPending);
  const downloadController = useRef<AbortController | null>(null);
  useEffect(() => () => downloadController.current?.abort(), []);
  const [downloadError, setDownloadError] = useState<unknown>();
  const [downloading, setDownloading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [copyNotice, setCopyNotice] = useState('');
  useEffect(() => {
    if (copyNotice !== '已复制') return;
    const timer = setTimeout(() => setCopyNotice(''), 1800);
    return () => clearTimeout(timer);
  }, [copyNotice]);
  const moreAnchor = useRef<HTMLDivElement>(null);
  return (
    <article className="conversation-turn" data-task-id={task.id}>
      <p className="conversation-user">{task.prompt}</p>
      <div className="conversation-result">
        {task.executionClass === 'verification' && (
          <div className="live-answer-heading">
            <Badge>联调验证 · 未调用真实模型</Badge>
          </div>
        )}
        {!task.reply && !task.sourcesUnavailable && live?.text && (
          <LiveReply live={live} running={['QUEUED', 'RUNNING'].includes(task.status)} />
        )}
        {task.reply && (
          <div className="conversation-reply">
            <ReplyText text={task.reply} />
          </div>
        )}
        {task.status === 'WAITING_INPUT' &&
          task.waitReason === 'PRESENTATION_CONFIRMATION' &&
          !task.sourcesUnavailable && (
            <PresentationDraft
              tenant={tenant}
              conversation={conversation}
              task={task.id}
              revision={task.revision}
              changed={changed}
            />
          )}
        {task.reply && retainedProcess.length > 0 && (
          <details className="reply-process-history">
            <summary>查看处理过程</summary>
            {retainedProcess.map((item) => (
              <div className="live-process-preview" key={`${item.attempt}:${item.step}`}>
                <ReplyText text={item.text} />
              </div>
            ))}
          </details>
        )}
        <ReplyProgress status={task.status} reconnecting={reconnecting} />
        {live?.state === 'INTERRUPTED' && !task.reply && !['QUEUED', 'RUNNING'].includes(task.status) && (
          <p className="reply-progress">已保留中断前的内容</p>
        )}
        {task.mode === 'SOURCE_LOOKUP' && task.status === 'SUCCEEDED' && (
          <p>
            {task.sourcesUnavailable
              ? '部分来源已不可访问。'
              : task.summaryCode === 'NO_SOURCES'
                ? '没有找到匹配的已解析资料。可以换一个关键词，或先在资料库检查解析状态。'
                : '以下是匹配的资料来源；未进行 AI 总结。'}
          </p>
        )}

        {readingOriginal && (
          <AttachmentReader
            tenant={tenant}
            file={readingOriginal}
            conversation={readingOriginal.attachmentConversationId || undefined}
            close={() => setReadingOriginal(undefined)}
          />
        )}
        {(task.originals.length > 0 || task.webSources.length > 0) && (
          <details className="reply-references">
            <summary>参考来源</summary>
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
            {task.publicQuery && (
              <p className="muted">
                {task.publicQuery === 'web:required:v1'
                  ? '本次要求联网查证'
                  : task.publicQuery === 'web:optional:v1'
                    ? 'AI 可按需联网'
                    : '公开检索内容：' + task.publicQuery}
              </p>
            )}
            {task.webSources.length > 0 && (
              <div className="conversation-web-sources" aria-label="公开网页来源">
                {task.webSources.map((source) => (
                  <details key={source.id}>
                    <summary>
                      {source.title} · {source.kind === 'PAGE' ? '已读取页面' : '检索线索 · 未读取页面'}
                    </summary>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      referrerPolicy="no-referrer"
                    >
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
          </details>
        )}
        {task.artifacts.map((file) => (
          <div className="reply-artifact" key={file.id}>
            <FileText size={22} aria-hidden="true" />
            <strong>{file.filename}</strong>
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
              下载
            </Button>
            {task.status === 'SUCCEEDED' && /\.(txt|md)$/i.test(file.filename) && (
              <SaveAsDocument
                tenant={tenant}
                conversation={conversation}
                task={task.id}
                artifact={file.id}
                label="编辑资料"
              />
            )}
          </div>
        ))}
        <SubmitError error={downloadError} uncertain={false} />
        <ReplyReferences sources={task.sources} citation={citation} />
        {task.supplementalInput && !task.sourcesUnavailable && (
          <details className="task-supplement-receipt">
            <summary>已补充</summary>
            <p>{task.supplementalInput}</p>
          </details>
        )}
        <TaskInterventionCard
          tenant={tenant}
          conversation={conversation}
          task={task}
          context={context}
          workspaceId={workspaceId}
          executing={executing}
          respond={respond}
          changed={changed}
        />
        <div className="reply-actions" aria-label="回复操作">
          {task.reply && (
            <Button
              icon={copyNotice === '已复制' ? Check : Copy}
              className={copyNotice === '已复制' ? 'is-copied' : undefined}
              variant="ghost"
              aria-label="复制回复"
              title={copyNotice || '复制'}
              onClick={() => {
                void navigator.clipboard.writeText(task.reply!).then(
                  () => setCopyNotice('已复制'),
                  () => setCopyNotice('复制失败，请选中文字复制'),
                );
              }}
            />
          )}
          {!task.sourcesUnavailable &&
            ['SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED', 'INTERRUPTED', 'RESULT_UNKNOWN'].includes(
              task.status,
            ) && (
              <ReplyFeedback
                tenant={tenant}
                target={{
                  kind: 'TASK',
                  taskId: task.id,
                  taskRevision: task.revision,
                  attempt: task.attempt,
                  presentationVersion: 'task-v1',
                  presentationRevision: 0,
                }}
              />
            )}
          {!task.sourcesUnavailable &&
            ['SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED', 'INTERRUPTED', 'RESULT_UNKNOWN'].includes(
              task.status,
            ) &&
            (task.attempt > 0 || (task.status === 'SUCCEEDED' && task.reply)) && (
              <div ref={moreAnchor} className="reply-more">
                <Button
                  icon={MoreHorizontal}
                  variant="ghost"
                  aria-label="更多回复操作"
                  aria-expanded={moreOpen}
                  disabled={pendingRequest}
                  onClick={() => {
                    if (!requestNavigationLocked()) setMoreOpen(!moreOpen);
                  }}
                />
                {moreOpen && (
                  <ActionPopover
                    anchor={moreAnchor}
                    label="更多回复操作"
                    onClose={() => {
                      if (!requestNavigationLocked()) setMoreOpen(false);
                    }}
                  >
                    {task.mode === 'AGENT' && task.status === 'SUCCEEDED' && task.reply && (
                      <SaveAsDocument tenant={tenant} conversation={conversation} task={task.id} />
                    )}
                    {task.attempt > 0 && (
                      <Button
                        icon={History}
                        variant="ghost"
                        onClick={() => {
                          if (requestNavigationLocked()) return;
                          setHistoryOpen(!historyOpen);
                          setMoreOpen(false);
                        }}
                      >
                        {historyOpen ? '收起过程' : '查看过程'}
                      </Button>
                    )}
                  </ActionPopover>
                )}
              </div>
            )}
          {copyNotice && copyNotice !== '已复制' && (
            <span role="status" className="reply-action-notice">
              {copyNotice}
            </span>
          )}
        </div>
        {!task.sourcesUnavailable && historyOpen && (
          <section className="reply-process" aria-label="回复处理过程">
            <header className="reply-process-heading">
              <span>
                <History size={15} aria-hidden="true" />
                处理过程
              </span>
              <Button icon={ChevronUp} variant="ghost" onClick={() => setHistoryOpen(false)}>
                收起过程
              </Button>
            </header>
            <TaskWorkNotices tenant={tenant} task={task.id} verification={task.revision} />
            <AttemptHistory
              tenant={tenant}
              conversation={conversation}
              task={task.id}
              revision={task.revision}
            />
          </section>
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
            <ChevronRight size={15} className="attempt-chevron" aria-hidden="true" />
            <span>第 {a.number} 次执行</span>
            <span className="attempt-status">{labels[a.status]}</span>
            {a.provenance === 'LEGACY_CURRENT_ONLY' ? ' · 旧记录仅保留当次事实' : ''}
          </summary>
          <div className="attempt-content">
            <p className="muted">
              {a.startedAt ? new Date(a.startedAt).toLocaleString() : '开始时间未知'}
              {a.finishedAt ? ' — ' + new Date(a.finishedAt).toLocaleString() : ''}
            </p>
            <p className="conversation-reply">{a.input}</p>
            {a.reply && <DocumentText text={a.reply} />}
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
                icon={FileText}
                variant="ghost"
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
          </div>
        </details>
      ))}
      <SubmitError error={downloadError} uncertain={false} />
      {(page > 0 || history.value.hasMore) && (
        <nav className="attempt-pagination" aria-label="执行历史翻页">
          <Button icon={ChevronLeft} variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>
            上一页
          </Button>
          <Button
            icon={ChevronRight}
            variant="ghost"
            disabled={!history.value.hasMore}
            onClick={() => setPage(page + 1)}
          >
            更早的执行
          </Button>
        </nav>
      )}
    </section>
  );
}
export function ConversationComposer({
  loading = false,
  onSending,
  controlTask,
  responseTask,
  clearResponse,
  suggestion,
  fromBriefing = false,
  briefingContext,
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
  loading?: boolean;
  onSending?: () => void;
  briefingContext?: ReadingTask;
  controlTask?: ConversationTask;
  responseTask?: ConversationTask;
  clearResponse?: () => void;
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
}) {
  const { session, expire } = useSession();
  const pendingRequest = useContext(RequestPending);
  type Followup = {
    task: string;
    expectedRevision: number;
    action: TaskAction;
    input: string;
    originals?: { materialId: string; versionId: string }[];
  };
  const followup = useSubmission<Followup>();
  const [lastFollowup, setLastFollowup] = useState<Followup>();
  useRequestLock(followup.busy || followup.uncertain);
  const key = `dreamcore:composer:${session.identity?.account.id}:${tenant}:${selected || (briefingContext ? 'briefing:' + briefingContext.taskId + ':' + briefingContext.taskRevision + ':' + briefingContext.attempt : 'new')}`;
  const [loaded] = useState(() => readTabDraft(key));
  const initial = useRef(record(loaded.value) ? loaded.value : {});
  const [stored, setStored] = useState(!loaded.unreadable);
  const pptCapability = useRemote((signal) => presentationClient.capability(tenant, signal), [tenant]);
  const [presentation, setPresentation] = useState<PresentationOptions | undefined>(() => {
    const value = initial.current.presentation;
    return record(value) &&
      Number.isInteger(value.pages) &&
      Number(value.pages) >= 1 &&
      Number(value.pages) <= 8 &&
      ['ocean', 'ink'].includes(String(value.theme))
      ? (value as unknown as PresentationOptions)
      : undefined;
  });
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
  const [pending, setPending] = useState<SendTask | undefined>(
    record(restored) &&
      uuid(restored.requestId) &&
      uuid(restored.workspaceId) &&
      typeof restored.prompt === 'string' &&
      ['SOURCE_LOOKUP', 'AGENT'].includes(String(restored.mode))
      ? (restored as unknown as SendTask)
      : undefined,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const [noticeHost, setNoticeHost] = useState<HTMLDivElement | null>(null);
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
  useComposerHeight(textarea, text, expanded, fromBriefing);
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
        presentation,
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
    presentation,
  ]);
  const allowed = context.workspaces.some((s) => s.id === (space || location));
  return (
    <form
      ref={form}
      className={`conversation-composer ${fromBriefing ? 'workspace-composer' : ''} ${expanded ? 'is-expanded' : ''} ${isCollapsed ? 'is-collapsed' : ''}`}
      inert={loading}
      aria-busy={loading}
      aria-label={fromBriefing ? '从画报发起会话' : undefined}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        // Safari may blur the input before a toolbar click focuses its popover.
        requestAnimationFrame(() => {
          if (form.current) setFocused(form.current.contains(document.activeElement));
        });
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length) {
          e.preventDefault();
          if (!busy && !pending)
            setDropped({ files: Array.from(e.dataTransfer.files), sequence: Date.now() });
        }
      }}
      onSubmit={async (event) => {
        event.preventDefault();
        if (selected && (controlTask || responseTask || followup.uncertain)) {
          if (
            followup.busy ||
            composing.current ||
            preparing ||
            (!followup.uncertain && (!enabled || !text.trim()))
          )
            return;
          const target = controlTask || responseTask;
          const body =
            followup.uncertain && lastFollowup
              ? lastFollowup
              : target
                ? {
                    task: target.id,
                    expectedRevision: target.revision,
                    action: controlTask ? ('SUPPLEMENT' as const) : ('RESUME' as const),
                    input: text.trim(),
                    originals: originals.map(({ materialId, versionId }) => ({ materialId, versionId })),
                  }
                : undefined;
          if (!body) return;
          onSending?.();
          setLastFollowup(body);
          await followup.submit(body, async (value, requestId) => {
            const { task, ...payload } = value;
            await api.action(tenant, selected, task, { ...payload, requestId });
            setText((current) => (current.trim() === value.input ? '' : current));
            setOriginals([]);
            clearResponse?.();
            changed();
          });
          return;
        }
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
          ...(!selected && briefingContext ? { briefingContext } : {}),
          workspaceId: space || location,
          prompt: text.trim(),
          mode,
          ...(presentation ? { presentation } : {}),
          sourceScope:
            selectedOnly && originals.length ? ('SELECTED' as const) : ('AUTHORIZED_LIBRARY' as const),
          ...(mode === 'AGENT' && originals.length
            ? { originals: originals.map(({ materialId, versionId }) => ({ materialId, versionId })) }
            : {}),
          ...(mode === 'AGENT' && !presentation && !selectedOnly && publicWebEnabled
            ? { publicQuery: publicQuery.trim() || 'web:optional:v1' }
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
            presentation,
          }),
        );
        setPending(body);
        onSending?.();
        submitting.current = true;
        setBusy(true);
        setError(undefined);
        const request = new AbortController();
        controller.current = request;
        try {
          const result = await api.send(tenant, selected || draftConversation, body, request.signal);
          if (request.signal.aborted) return;
          setText('');
          setPresentation(undefined);
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
        <div className="composer-notices" ref={setNoticeHost}>
          <SubmitError error={followup.error} uncertain={followup.uncertain} />
          <DraftWarning unavailable={!stored} unreadable={loaded.unreadable} pending={!!pending} />
          <SubmitError error={error} uncertain={!!pending && !busy} />
        </div>
        <fieldset disabled={loading || busy || !!pending || followup.busy || followup.uncertain}>
          {responseTask && (
            <div className="composer-response-target">
              <span>回复：{responseTask.requiredInput || '补充所需信息'}</span>
              <Button
                variant="ghost"
                disabled={followup.busy || followup.uncertain}
                onClick={() => clearResponse?.()}
              >
                另起话题
              </Button>
            </div>
          )}
          {presentation && (
            <div className="presentation-options" aria-label="PPT 生成设置">
              <strong>PPT 生成</strong>
              <label>
                页数{' '}
                <select
                  aria-label="PPT 页数"
                  value={presentation.pages}
                  onChange={(e) => setPresentation({ ...presentation, pages: Number(e.target.value) })}
                >
                  {Array.from({ length: 8 }, (_, i) => (
                    <option key={i} value={i + 1}>
                      {i + 1} 页
                    </option>
                  ))}
                </select>
              </label>
              <label>
                风格{' '}
                <select
                  aria-label="PPT 风格"
                  value={presentation.theme}
                  onChange={(e) =>
                    setPresentation({
                      ...presentation,
                      theme: e.target.value as PresentationOptions['theme'],
                    })
                  }
                >
                  <option value="ocean">海蓝商务</option>
                  <option value="ink">墨色简约</option>
                </select>
              </label>
              <Button variant="ghost" onClick={() => setPresentation(undefined)}>
                取消技能
              </Button>
              <small>填写主题，可通过附件选择空间资料。先确认大纲，再生成 PPT。</small>
            </div>
          )}
          <div className="live-composer-input">
            <Field label={mode === 'AGENT' ? '工作要求' : '资料关键词'}>
              <textarea
                ref={textarea}
                aria-label={fromBriefing ? '新的工作需求' : mode === 'AGENT' ? '工作要求' : '资料关键词'}
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
                maxLength={presentation ? 1900 : mode === 'AGENT' ? 2000 : 200}
                rows={3}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={
                  presentation ? '这份 PPT 讲什么？面向谁？希望达成什么目的？' : '告诉我你想处理的工作'
                }
              />
            </Field>
          </div>
          <div className="live-composer-controls" inert={fromBriefing && !expanded}>
            <div className="live-composer-controls-content">
              <div className="live-composer-tools">
                {!responseTask && !briefingContext && (
                  <Button
                    variant="ghost"
                    aria-label="技能：PPT 生成"
                    aria-pressed={!!presentation}
                    disabled={!pptCapability.value?.available || preparing}
                    title={
                      pptCapability.value?.available ? '生成可编辑 PPT，先确认大纲' : 'PPT 生成环境尚未开放'
                    }
                    onClick={() => {
                      setPresentation(presentation ? undefined : { pages: 6, theme: 'ocean' });
                      textarea.current?.focus();
                    }}
                  >
                    PPT 生成
                  </Button>
                )}
                <div ref={toolsAnchor} className="live-composer-workspace">
                  {selected || draftConversation ? (
                    <span className="button live-workspace-label" title="会话工作空间">
                      <Folder size={16} aria-hidden="true" />
                      {context.workspaces.find((s) => s.id === (space || location))?.name || '工作空间不可用'}
                    </span>
                  ) : (
                    <Button
                      icon={Folder}
                      variant="ghost"
                      aria-label="选择工作空间"
                      aria-expanded={toolsOpen}
                      disabled={uploading || pendingRequest}
                      onClick={() => setToolsOpen(!toolsOpen)}
                    >
                      {context.workspaces.find((s) => s.id === location)?.name || '选择工作空间'}
                      <ChevronDown size={12} />
                    </Button>
                  )}
                  {toolsOpen && !selected && !draftConversation && (
                    <ActionPopover
                      anchor={toolsAnchor}
                      label="选择工作空间"
                      onClose={() => setToolsOpen(false)}
                    >
                      {context.workspaces.map((workspace) => (
                        <Button
                          key={workspace.id}
                          icon={Folder}
                          variant="ghost"
                          aria-pressed={location === workspace.id}
                          onClick={() => {
                            setLocation(workspace.id);
                            setToolsOpen(false);
                          }}
                        >
                          {workspace.name}
                        </Button>
                      ))}
                    </ActionPopover>
                  )}
                </div>
                <AttachmentMaterials
                  tenant={tenant}
                  conversation={selected || draftConversation}
                  draftRequestId={draftRequestId}
                  workspaceId={space || location}
                  context={context}
                  files={originals}
                  setFiles={setOriginals}
                  onConversation={(id, workspaceId) => {
                    setDraftConversation(id);
                    if (workspaceId) setLocation(workspaceId);
                  }}
                  onBusy={setUploading}
                  onReady={onReady}
                  dropped={dropped}
                  verification={agentMode === 'verification'}
                />
                {!selectedOnly && publicWebEnabled && (
                  <Button
                    icon={Globe}
                    variant="ghost"
                    className="live-web-toggle"
                    aria-label="联网"
                    aria-pressed={
                      controlTask || responseTask
                        ? (controlTask || responseTask)?.publicQuery === 'web:required:v1'
                        : !!publicQuery
                    }
                    disabled={!!controlTask || !!responseTask}
                    title={
                      controlTask || responseTask
                        ? '当前任务沿用原联网设置'
                        : publicQuery
                          ? '本次优先联网查证'
                          : '由 AI 按需联网'
                    }
                    onClick={() => setPublicQuery(publicQuery ? '' : 'web:required:v1')}
                  >
                    联网
                  </Button>
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
            </div>
          </div>
        </fieldset>
        {controlTask && selected && (
          <TaskSendControl
            tenant={tenant}
            conversation={selected}
            task={controlTask}
            besideSend={!!text.trim() || followup.uncertain}
            noticeHost={noticeHost}
            changed={changed}
          />
        )}
        {(!controlTask || !!text.trim() || followup.uncertain) && (
          <Button
            icon={ArrowUp}
            className="live-composer-submit"
            type="submit"
            variant="primary"
            aria-label={
              followup.uncertain
                ? '重试本次发送'
                : controlTask
                  ? '发送补充'
                  : responseTask
                    ? '提交回答并继续'
                    : busy
                      ? '提交中…'
                      : pending
                        ? '重试上次发送'
                        : fromBriefing
                          ? '发送消息'
                          : mode === 'AGENT'
                            ? '开始任务'
                            : '查找资料'
            }
            title={
              preparing
                ? '资料准备中'
                : !enabled && disabledReason
                  ? disabledReason
                  : busy
                    ? '提交中…'
                    : pending
                      ? '重试上次发送'
                      : fromBriefing
                        ? '发送消息'
                        : mode === 'AGENT'
                          ? '开始任务'
                          : '查找资料'
            }
            disabled={
              busy ||
              preparing ||
              followup.busy ||
              (!followup.uncertain && (!enabled || !allowed || !text.trim()))
            }
          >
            <span className="live-visually-hidden">
              {busy
                ? '提交中…'
                : pending
                  ? '重试上次发送'
                  : fromBriefing
                    ? '发送消息'
                    : mode === 'AGENT'
                      ? '开始任务'
                      : '查找资料'}
            </span>
          </Button>
        )}
      </div>
    </form>
  );
  function locationHash(id: string) {
    window.location.hash = briefingContext
      ? briefingConversationHref(tenant, briefingContext, id)
      : fromBriefing
        ? conversationHref(tenant, id) + '&from=briefing'
        : retainConversationContext(conversationHref(tenant, id), window.location.hash);
  }
}

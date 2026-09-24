import { readTabDraft, writeTabDraft, removeTabDraft } from '../shared/tab-drafts';
import { DraftWarning } from '../shared/DraftWarning';
import { SaveAsDocument } from '../documents/Documents';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle, Plus, RefreshCw, Send } from 'lucide-react';
import type {
  ConversationDetail,
  ConversationTask,
  ConversationPage,
  SendTask,
  TaskOriginal,
} from '../../contracts/public-api/conversation';
import type { TenantContext } from '../../contracts/public-api/identity';
import { identityClient, useSession } from '../identity/session';
import { IdentityError, record, uuid } from '../identity/client';
import { Button, Badge, Field, PageActions, Modal } from '../shared/ui';
import { Failure, Loading, Pager, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { Citation } from '../material/Knowledge';
import { OriginalPicker } from './OriginalPicker';
import { taskErrorMessage } from './task-errors';
import { conversationClient as api, isOriginal } from './client';
import './conversation.css';
export const conversationHref = (tenant: string, id?: string) =>
  '#' + new URLSearchParams({ tenant, view: 'conversations', ...(id ? { conversation: id } : {}) });
export function Conversations({ tenant }: { tenant: string }) {
  const { session, expire } = useSession();
  const [contextAttempt, setContextAttempt] = useState(0);
  const [hash, setHash] = useState(location.hash),
    [attempt, setAttempt] = useState(0),
    [page, setPage] = useState(0);
  useEffect(() => {
    const change = () => setHash(location.hash);
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
          icon={Plus}
          onClick={() => {
            location.hash = conversationHref(tenant);
          }}
        >
          新会话
        </Button>
        <Button
          variant="ghost"
          icon={RefreshCw}
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
        <div className="live-conversations">
          <aside className="conversation-list" aria-label="会话列表">
            <h2>会话列表</h2>
            <p className="muted">仅自己可见</p>
            {list.value.items.map((c) => (
              <a
                key={c.id}
                className={selected === c.id ? 'selected' : ''}
                href={conversationHref(tenant, c.id)}
              >
                <MessageCircle size={16} />
                <span>{c.title}</span>
              </a>
            ))}
            {!list.value.items.length && <p className="muted">发送后会保留会话记录。</p>}
            <Pager page={page} next={list.value.hasMore} onPage={setPage} />
          </aside>
          <ConversationView
            key={(selected || 'new') + ':' + (focused || '')}
            tenant={tenant}
            selected={selected}
            focused={focused}
            context={context.value}
            enabled={list.value.enabled}
            agentMode={list.value.agentMode}
            publicWebEnabled={list.value.publicWebEnabled}
            changed={changed}
          />
        </div>
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
}: {
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
  const [data, setData] = useState<{ value?: ConversationDetail; error?: unknown }>({});
  const [attempt, setAttempt] = useState(0),
    [page, setPage] = useState(0),
    [citation, setCitation] = useState<string>();
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
        ? await api.historical(tenant, selected, focused, controller.signal)
        : await api.detail(tenant, selected, page * 20, controller.signal);
      if (!controller.signal.aborted) {
        valueRef.current = value;
        setData({ value });
      }
    };
    const poll = async () => {
      try {
        const events = await api.events(tenant, selected, valueRef.current?.cursor || 0, controller.signal);
        if (events.items.length) {
          await load();
          changed();
        }
        if (!controller.signal.aborted) timer = setTimeout(poll, 1500);
      } catch (error) {
        failure(error);
      }
    };
    if (!uuid(selected)) {
      failure(new IdentityError('CONVERSATION_NOT_FOUND', 404));
      return;
    }
    void load()
      .then(() => {
        if (!controller.signal.aborted) timer = setTimeout(poll, 1500);
      })
      .catch(failure);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [tenant, selected, focused, page, attempt, session.identity, context, expire, changed]);
  const refresh = () => {
    setAttempt((x) => x + 1);
    changed();
  };
  const active = !!data.value?.tasks.some((t) => ['QUEUED', 'RUNNING'].includes(t.status));
  if (data.error)
    return (
      <section className="conversation-reader">
        <Failure error={data.error} retry={refresh} />
      </section>
    );
  if (selected && !data.value) return <Loading />;
  return (
    <section className="conversation-reader">
      <header>
        <div>
          <h2>{data.value?.conversation.title || '开始新会话'}</h2>
          <p className="muted">
            {agentMode === 'off'
              ? '本地资料检索 · 未调用模型'
              : agentMode === 'verification'
                ? '联调验证 · 未调用真实模型'
                : '资料检索与 AI 工作任务'}
          </p>
        </div>
        <Badge>私人会话</Badge>
      </header>
      <div className="conversation-messages" aria-live="polite">
        {data.value?.tasks.map((task) => (
          <TaskCard
            key={task.id}
            tenant={tenant}
            conversation={selected!}
            task={task}
            changed={refresh}
            citation={setCitation}
          />
        ))}
        {!data.value && (
          <div className="conversation-intro">
            <MessageCircle size={30} />
            <h3>{agentMode === 'off' ? '从资料里找依据' : '围绕资料开展工作'}</h3>
            <p>
              选择资料范围，输入关键词，查看带文件版本和位置的来源。
              {agentMode === 'off'
                ? 'AI 生成回复将在模型接入后开放。'
                : publicWebEnabled
                  ? '任务可读取所选范围内的资料片段，也可查找你指定的公开内容。'
                  : '任务使用所选范围内的资料，也可指定文件版本供工具处理。'}
            </p>
          </div>
        )}
        {data.value && !focused && <Pager page={page} next={data.value.hasMore} onPage={setPage} />}
      </div>
      {focused ? (
        <p className="conversation-history-note">
          正在查看历史画报对应的原始回复。
          <Button
            onClick={() => {
              location.hash = conversationHref(tenant, selected);
            }}
          >
            返回最新对话并继续
          </Button>
        </p>
      ) : (
        <Composer
          tenant={tenant}
          selected={selected}
          space={data.value?.conversation.workspaceId}
          context={context}
          enabled={enabled && !active && page === 0}
          agentMode={agentMode}
          publicWebEnabled={publicWebEnabled}
          disabledReason={
            !enabled
              ? '资料检索暂未开放。'
              : active
                ? '请等待当前任务结束，或先取消任务。'
                : page !== 0
                  ? '返回最新记录后可继续发送。'
                  : ''
          }
          changed={refresh}
        />
      )}
      {citation && (
        <Modal title="资料来源" onClose={() => setCitation(undefined)} wide>
          <Citation
            tenant={tenant}
            id={citation}
            verification={context}
            back={() => setCitation(undefined)}
          />
        </Modal>
      )}
    </section>
  );
}
const labels: Record<string, string> = {
  QUEUED: '等待执行',
  RUNNING: '正在查找资料',
  SUCCEEDED: '检索完成',
  FAILED: '执行未完成',
  CANCELLED: '已取消',
  INTERRUPTED: '执行中断',
};
function TaskCard({
  tenant,
  conversation,
  task,
  changed,
  citation,
}: {
  tenant: string;
  conversation: string;
  task: ConversationTask;
  changed: () => void;
  citation: (id: string) => void;
}) {
  const { expire } = useSession();
  const downloadController = useRef<AbortController | null>(null);
  useEffect(() => () => downloadController.current?.abort(), []);
  const [downloadError, setDownloadError] = useState<unknown>();
  const [downloading, setDownloading] = useState(false);
  const submit = useSubmission<{ expectedRevision: number; action: 'CANCEL' | 'RETRY' }>();
  return (
    <article className="conversation-turn">
      <p className="conversation-user">{task.prompt}</p>
      <div className="conversation-result">
        <strong>
          {task.mode === 'AGENT' && task.status === 'RUNNING'
            ? '正在执行任务'
            : task.mode === 'AGENT' && task.status === 'SUCCEEDED'
              ? '任务完成'
              : labels[task.status]}
        </strong>
        {task.mode === 'AGENT' && (
          <Badge>{task.executionClass === 'verification' ? '联调验证 · 未调用真实模型' : 'AI 任务'}</Badge>
        )}
        {task.reply && <p className="conversation-reply">{task.reply}</p>}
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
        {task.originals.length > 0 && (
          <div className="conversation-originals" aria-label="本次指定的原件">
            {task.originals.map((file) => (
              <p key={file.versionId}>
                <strong>
                  {file.filename} · v{file.version}
                </strong>
                <span>{file.read ? '已读取原件' : '已选用 · 尚未读取'}</span>
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
        {['QUEUED', 'RUNNING', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(task.status) && (
          <Button
            disabled={submit.busy}
            onClick={() =>
              void submit.submit(
                {
                  expectedRevision: task.revision,
                  action: ['QUEUED', 'RUNNING'].includes(task.status) ? 'CANCEL' : 'RETRY',
                },
                async (body, requestId) => {
                  try {
                    await api.action(tenant, conversation, task.id, { ...body, requestId });
                  } finally {
                    changed();
                  }
                },
              )
            }
          >
            {['QUEUED', 'RUNNING'].includes(task.status) ? '取消任务' : '重试任务'}
          </Button>
        )}
        <SubmitError error={submit.error} uncertain={submit.uncertain} />
      </div>
    </article>
  );
}
function Composer({
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
}) {
  const { session, expire } = useSession();
  const key = `dreamcore:composer:${session.identity?.account.id}:${tenant}:${selected || 'new'}`;
  const [loaded] = useState(() => readTabDraft(key));
  const initial = useRef(record(loaded.value) ? loaded.value : {});
  const [stored, setStored] = useState(!loaded.unreadable);
  const [mode, setMode] = useState<SendTask['mode']>(
    initial.current.mode === 'AGENT' && agentMode !== 'off' ? 'AGENT' : 'SOURCE_LOOKUP',
  );
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
  const [picking, setPicking] = useState(false);
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
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    setStored(writeTabDraft(key, { text, mode, publicQuery, space: location, originals, pending }));
  }, [key, text, mode, publicQuery, location, originals, pending]);
  const allowed = context.workspaces.some((s) => s.id === (space || location));
  return (
    <form
      className="conversation-composer"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || !enabled || !allowed) return;
        const body = pending || {
          requestId: crypto.randomUUID(),
          workspaceId: space || location,
          prompt: text.trim(),
          mode,
          ...(mode === 'AGENT' && agentMode === 'verification' && originals.length
            ? { originals: originals.map(({ materialId, versionId }) => ({ materialId, versionId })) }
            : {}),
          ...(mode === 'AGENT' && publicWebEnabled && publicQuery.trim()
            ? { publicQuery: publicQuery.trim() }
            : {}),
        };
        setStored(writeTabDraft(key, { text, mode, publicQuery, space: location, originals, pending: body }));
        setPending(body);
        setBusy(true);
        setError(undefined);
        const request = new AbortController();
        controller.current = request;
        try {
          const result = await api.send(tenant, selected, body, request.signal);
          if (request.signal.aborted) return;
          setText('');
          setPublicQuery('');
          setOriginals([]);
          setPending(undefined);
          setStored(removeTabDraft(key));
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
          if (!request.signal.aborted) setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy || !!pending}>
        <Field label="资料范围">
          <select
            value={space || location}
            disabled={!!space}
            onChange={(e) => {
              setLocation(e.target.value);
              setOriginals([]);
              setPicking(false);
            }}
          >
            {context.workspaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.kind === 'PERSONAL' ? '（个人）' : ''}
              </option>
            ))}
          </select>
        </Field>
        {agentMode !== 'off' && (
          <Field label="任务方式">
            <select
              aria-label="任务方式"
              value={mode}
              onChange={(e) => setMode(e.target.value as SendTask['mode'])}
            >
              <option value="SOURCE_LOOKUP">查找资料（不调用模型）</option>
              <option value="AGENT">{agentMode === 'verification' ? 'Agent 联调验证' : 'AI 工作任务'}</option>
            </select>
          </Field>
        )}
        {mode === 'AGENT' && agentMode === 'verification' && (
          <div className="original-selection">
            <Button disabled={!allowed} onClick={() => setPicking(true)}>
              选择原件版本
            </Button>
            {originals.map((file) => (
              <div key={file.versionId}>
                <span>
                  {file.filename} · v{file.version}
                </span>
                <Button
                  variant="ghost"
                  onClick={() => setOriginals((files) => files.filter((f) => f.versionId !== file.versionId))}
                >
                  移除 {file.filename}
                </Button>
              </div>
            ))}
            <small>选用原件后，仅在这些版本中检索与处理；未选用时检索所选空间。</small>
          </div>
        )}
        <Field label={mode === 'AGENT' ? '工作要求' : '资料关键词'}>
          <textarea
            aria-label={mode === 'AGENT' ? '工作要求' : '资料关键词'}
            required
            maxLength={mode === 'AGENT' ? 2000 : 200}
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              mode === 'AGENT'
                ? '描述需要整理、分析的工作和所需结果'
                : '例如：项目进度（多个关键词用空格分开）'
            }
          />
        </Field>
        {mode === 'AGENT' && publicWebEnabled && (
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
        )}
      </fieldset>
      <div className="conversation-send">
        <small>
          {stored && !loaded.unreadable && '草稿在本标签页恢复；'}
          {mode === 'AGENT' ? '最多 2000 字，使用资料片段及本次指定的原件。' : '最多 8 个关键词。'}
          {disabledReason}
        </small>
        <Button
          icon={Send}
          type="submit"
          variant="primary"
          disabled={busy || !enabled || !allowed || !text.trim()}
        >
          {busy ? '提交中…' : pending ? '重试上次发送' : mode === 'AGENT' ? '开始任务' : '查找资料'}
        </Button>
      </div>
      <DraftWarning unavailable={!stored} unreadable={loaded.unreadable} pending={!!pending} />
      <SubmitError error={error} uncertain={!!pending && !busy} />
      {picking && !busy && !pending && (
        <OriginalPicker
          key={space || location}
          tenant={tenant}
          space={space || location}
          selected={originals}
          onSelect={(file) =>
            setOriginals((files) => [...files.filter((f) => f.materialId !== file.materialId), file])
          }
          onClose={() => setPicking(false)}
        />
      )}
    </form>
  );
  function locationHash(id: string) {
    window.location.hash = conversationHref(tenant, id);
  }
}

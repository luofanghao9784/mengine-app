import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowUpRight, Download, ListChecks, Pause, Play, RefreshCw, Share2 } from 'lucide-react';
import type { Workspace } from '../../contracts/public-api/identity';
import type { NativeArtifact, NativeConversation } from '../../contracts/public-api/native-conversations';
import { LiveConversationDeck } from '../conversation/LiveConversationDeck';
import { CardTypeTag } from '../conversation/CardTypeTag';
import { Button, Field, IconButton } from '../shared/ui';
import { IdentityError } from '../identity/client';
import { nativeConversationClient as api } from './client';
import { useNativeSessions, nativeHref } from './useNativeConversations';
import { nativeSessionTitle } from './labels';
import { NativeChat, type NativeStatus } from './chat/NativeChat';
import { useNativeFeed } from './chat/useNativeFeed';
import { buildTranscript } from './chat/transcript.ts';
import { buildWorkState } from './chat/work.ts';
import { NativeWorkPanel, workCount } from './chat/NativeWorkPanel';
import './native-conversation.css';

const oldConversationHref = (tenant: string, id: string) =>
  '#' + new URLSearchParams({ tenant, view: 'conversations', conversation: id });
const message = (error: unknown) =>
  error instanceof IdentityError
    ? error.message
    : error instanceof Error
      ? error.message
      : '操作未完成，请稍后重试。';
const size = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1048576).toFixed(1)} MB`;
const spaceName = (w?: Workspace) => (w ? (w.kind === 'PERSONAL' ? '个人空间' : w.name) : '');

/**
 * 原生会话在梦擎会话页里的视图：对话在这张卡片里进行，旁边一张“进展 / 成果”卡。
 * 所有状态都来自服务端回执与会话记录。
 */
export function NativeConversationView({
  tenant,
  id,
  legacy,
  workspaces,
  oldConversations,
  navigation,
  onChanged,
}: {
  tenant: string;
  id: string;
  legacy?: string;
  workspaces: Workspace[];
  oldConversations: { id: string; title: string; workspaceId: string }[];
  navigation: ReactNode;
  onChanged: () => void;
}) {
  const [revision, setRevision] = useState(0);
  const sessions = useNativeSessions(
    tenant,
    workspaces.map((w) => w.id),
    true,
    revision,
  );
  const titles = useMemo(() => new Map(oldConversations.map((c) => [c.id, c.title])), [oldConversations]);
  const session = sessions.items.find((s) => s.id === id);
  const refresh = () => {
    setRevision((x) => x + 1);
    onChanged();
  };
  const isNew = id === 'new';
  const feed = useNativeFeed(tenant, id, { enabled: !isNew, active: session?.state === 'ACTIVE' });
  const transcript = useMemo(() => (feed ? buildTranscript(feed.events) : null), [feed]);
  const work = useMemo(() => (feed ? buildWorkState(feed.events) : null), [feed]);
  useEffect(() => {
    // ⌘/Ctrl + Shift + O opens a new native session (one of the four agreed shortcuts).
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'o' && !isNew) {
        e.preventDefault();
        location.hash = nativeHref(tenant, 'new');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tenant, isNew]);
  const [sideOpen, setSideOpen] = useState(true);
  const [tab, setTab] = useState<'work' | 'results'>('work');
  const chat = !!(feed && transcript && session);
  const space = spaceName(workspaces.find((w) => w.id === session?.workspaceId));
  const title = isNew
    ? '新会话'
    : transcript?.title || (session ? nativeSessionTitle(session, titles) : '会话');
  const subtitle = isNew ? '' : session?.state === 'STOPPED' ? `${space} · 已停止` : space;
  const openResults = () => {
    setTab('results');
    setSideOpen(true);
  };
  const count = work ? workCount(work) : '';
  return (
    <LiveConversationDeck
      tenant={tenant}
      navigation={navigation}
      persistenceKey={`native:${id}`}
      title={title}
      heading={
        <>
          <h2 title={title}>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </>
      }
      headerActions={
        chat && !sideOpen ? (
          <IconButton icon={ListChecks} label="进展与成果" onClick={() => setSideOpen(true)} />
        ) : undefined
      }
      onClose={() => {
        location.hash = '#tenant=' + tenant + '&view=briefing';
      }}
      cards={
        chat && session && sideOpen
          ? [
              {
                id: 'native-side',
                kind: 'file' as const,
                tag: tab === 'work' ? ('进展' as const) : ('成果' as const),
                icon: ListChecks,
                title,
                label: count ? `进展 ${count}` : '进展',
                content: (
                  <div className="native-side">
                    <div className="native-tabs" role="tablist" aria-label="进展与成果">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={tab === 'work'}
                        onClick={() => setTab('work')}
                      >
                        进展{count && <span>{count}</span>}
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={tab === 'results'}
                        onClick={() => setTab('results')}
                      >
                        成果
                      </button>
                    </div>
                    {tab === 'work' && work ? (
                      <NativeWorkPanel work={work} />
                    ) : (
                      <NativeResults
                        tenant={tenant}
                        session={session}
                        workspaces={workspaces}
                        status={feed?.status}
                        legacyTitle={
                          session.legacyConversationId ? titles.get(session.legacyConversationId) : undefined
                        }
                        onChanged={refresh}
                      />
                    )}
                  </div>
                ),
                close: () => setSideOpen(false),
              },
            ]
          : []
      }
    >
      <section className="conversation-reader native-reader">
        <header className="deck-card-header live-card-heading">
          <div>
            <CardTypeTag type="会话" />
            <h2 title={title}>{title}</h2>
            {subtitle && <p className="muted">{subtitle}</p>}
          </div>
        </header>
        {chat && feed && transcript ? (
          <>
            {feed.preview && (
              <p className="native-preview-banner" role="note">
                预览数据：用于在本地查看界面，不是真实会话，操作不会发送到服务器。
              </p>
            )}
            <NativeChat
              transcript={transcript}
              status={feed.status}
              actions={feed.actions}
              skills={feed.skills}
              workspace={space}
              onOpenResults={openResults}
              ratings={feed.ratings}
              loading={feed.loading}
              notice={feed.notice}
              unavailable={
                feed.preview
                  ? '预览中不可用'
                  : session?.state === 'ACTIVE'
                    ? '当前不可操作'
                    : '会话已停止，在“成果”里恢复后可继续'
              }
            />
          </>
        ) : (
          <div className="native-reader-body">
            {isNew ? (
              <NativeCreate
                tenant={tenant}
                legacy={legacy}
                workspaces={workspaces}
                oldConversations={oldConversations}
                onCreated={(s) => {
                  refresh();
                  location.hash = nativeHref(tenant, s.id);
                }}
              />
            ) : sessions.loading && !session ? (
              <p className="platform-loading" role="status">
                正在读取…
              </p>
            ) : (
              <p className="native-note">找不到这个会话，或你已没有它所在空间的访问权限。</p>
            )}
          </div>
        )}
      </section>
    </LiveConversationDeck>
  );
}

function NativeCreate({
  tenant,
  legacy,
  workspaces,
  oldConversations,
  onCreated,
}: {
  tenant: string;
  legacy?: string;
  workspaces: Workspace[];
  oldConversations: { id: string; title: string; workspaceId: string }[];
  onCreated: (session: NativeConversation) => void;
}) {
  const fromLegacy = oldConversations.find((c) => c.id === legacy);
  const [space, setSpace] = useState(
    fromLegacy?.workspaceId ?? workspaces.find((w) => w.kind === 'PERSONAL')?.id ?? workspaces[0]?.id ?? '',
  );
  const [previous, setPrevious] = useState(fromLegacy?.id ?? '');
  // 同一组选择重试时沿用同一个请求号（服务端去重）；改了选择就换新号。
  const requestId = useMemo(() => crypto.randomUUID(), [space, previous]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const candidates = oldConversations.filter((c) => c.workspaceId === space);
  useEffect(() => {
    if (previous && !candidates.some((c) => c.id === previous)) setPrevious('');
  }, [space]);
  return (
    <div className="native-section">
      <p className="native-note">
        企业资料按你在梦擎的权限读取；AI 生成的文件先存为你的私人成果，经你确认才会发布到共享空间。
      </p>
      <Field label="工作空间">
        <select value={space} disabled={busy} onChange={(e) => setSpace(e.target.value)}>
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.kind === 'PERSONAL' ? '个人空间' : w.name}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label="接续旧会话（可选）"
        hint="旧会话原样保留。接续最多带入最近 50 条已结束、当前仍可读的记录，不恢复旧的工具过程。"
      >
        <select value={previous} disabled={busy} onChange={(e) => setPrevious(e.target.value)}>
          <option value="">不接续，开始新会话</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </Field>
      {error && (
        <p className="native-error" role="alert">
          {error}
        </p>
      )}
      <div className="native-actions">
        <Button
          variant="primary"
          disabled={busy || !space}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              onCreated(await api.open(tenant, space, previous || null, requestId));
            } catch (e) {
              setError(message(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? '正在创建…' : '开始'}
        </Button>
      </div>
    </div>
  );
}

/** 成果：私人成果文件、本次费用，以及停止 / 恢复会话。 */
function NativeResults({
  tenant,
  session,
  workspaces,
  status,
  legacyTitle,
  onChanged,
}: {
  tenant: string;
  session: NativeConversation;
  workspaces: Workspace[];
  status?: NativeStatus;
  legacyTitle?: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await work();
      onChanged();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const active = session.state === 'ACTIVE';
  const budget = status?.budget;
  const occupied = budget ? budget.usedYuan + (budget.reservedYuan ?? 0) : 0;
  return (
    <div className="native-results">
      <NativeArtifacts tenant={tenant} session={session} workspaces={workspaces} />
      {budget && (
        <section className="native-work-section">
          <h3>本次费用</h3>
          <p className="native-cost">
            <strong>¥{occupied.toFixed(2)}</strong>
            <small>
              {budget.reservedYuan ? `含预留 ¥${budget.reservedYuan.toFixed(2)} · ` : ''}提醒线 ¥
              {budget.softYuan} · 上限 ¥{budget.hardYuan}
            </small>
          </p>
          <div className="native-meter" aria-hidden="true">
            <span style={{ width: `${Math.min(100, (occupied / budget.hardYuan) * 100)}%` }} />
          </div>
          <small className="native-muted">
            {status?.stale
              ? '最后一次记录'
              : budget.elapsedMinutes !== undefined
                ? `本轮已运行 ${Math.round(budget.elapsedMinutes)} 分钟`
                : ''}
            {status?.synthetic ? ' · 测试模型，不产生费用' : ''}
          </small>
        </section>
      )}
      <section className="native-work-section">
        <h3>会话</h3>
        <p className="native-note">
          {active
            ? '企业资料与权限沿用梦擎。停止后执行授权会撤销，之后可随时恢复。'
            : '这个会话已停止。恢复后沿用原来的记录、预算和工作文件。'}
        </p>
        {session.legacyConversationId && (
          <p className="native-note">
            接续自
            <a href={oldConversationHref(tenant, session.legacyConversationId)}>
              {legacyTitle ? `「${legacyTitle}」` : '旧会话'}
              <ArrowUpRight size={13} aria-hidden="true" />
            </a>
          </p>
        )}
        <div className="native-actions">
          {active ? (
            <Button icon={Pause} disabled={busy} onClick={() => run(() => api.stop(tenant, session.id))}>
              停止会话
            </Button>
          ) : (
            <Button
              variant="primary"
              icon={Play}
              disabled={busy}
              onClick={() => run(() => api.resume(tenant, session.id))}
            >
              恢复会话
            </Button>
          )}
        </div>
        {error && (
          <p className="native-error" role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}

function NativeArtifacts({
  tenant,
  session,
  workspaces,
}: {
  tenant: string;
  session: NativeConversation;
  workspaces: Workspace[];
}) {
  const [files, setFiles] = useState<NativeArtifact[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [publishing, setPublishing] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoadError('');
    api.artifacts(tenant, session.id, controller.signal).then(setFiles, (e) => {
      if (!controller.signal.aborted) setLoadError(message(e));
    });
    return () => controller.abort();
  }, [tenant, session.id, attempt]);
  const shared = workspaces.filter((w) => w.kind === 'SHARED');
  return (
    <section className="native-work-section">
      <h3>
        私人成果 · 只有你看得到
        <IconButton icon={RefreshCw} label="刷新私人成果" onClick={() => setAttempt((x) => x + 1)} />
      </h3>
      {loadError ? (
        <p className="native-error" role="alert">
          {loadError}
        </p>
      ) : files === null ? (
        <p className="platform-loading" role="status">
          正在读取…
        </p>
      ) : !files.length ? (
        <p className="native-muted">还没有成果文件。AI 保存的文件会出现在这里。</p>
      ) : (
        <ul className="native-files">
          {files.map((f) => (
            <li key={f.id}>
              <a href={api.artifactHref(tenant, session.id, f.id)} download>
                <Download size={14} aria-hidden="true" />
                <span>{f.filename}</span>
              </a>
              <small>{size(f.bytes)}</small>
              <Button
                variant="ghost"
                icon={Share2}
                disabled={!shared.length}
                title={shared.length ? undefined : '你没有可发布的共享空间'}
                onClick={() => setPublishing(publishing === f.id ? null : f.id)}
              >
                发布
              </Button>
              {publishing === f.id && (
                <NativePublish
                  tenant={tenant}
                  session={session}
                  artifact={f}
                  shared={shared}
                  onDone={() => setPublishing(null)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function NativePublish({
  tenant,
  session,
  artifact,
  shared,
  onDone,
}: {
  tenant: string;
  session: NativeConversation;
  artifact: NativeArtifact;
  shared: Workspace[];
  onDone: () => void;
}) {
  const [destination, setDestination] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const requestId = useMemo(() => crypto.randomUUID(), [destination]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState('');
  return (
    <div className="native-publish">
      {receipt ? (
        <>
          <p className="native-notice" role="status">
            已发布到「{shared.find((w) => w.id === destination)?.name}」，资料库会显示这份文件。
          </p>
          <Button variant="ghost" onClick={onDone}>
            完成
          </Button>
        </>
      ) : (
        <>
          <Field label="发布到" hint="发布前会再次核对：目标空间的每位读者都必须能读到这次会话用到的资料。">
            <select value={destination} disabled={busy} onChange={(e) => setDestination(e.target.value)}>
              <option value="">选择共享空间</option>
              {shared.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </Field>
          <label className="native-ack">
            <input
              type="checkbox"
              checked={acknowledged}
              disabled={busy}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            我已核对「{artifact.filename}」的内容和共享范围
          </label>
          {error && (
            <p className="native-error" role="alert">
              {error}
            </p>
          )}
          <div className="native-actions">
            <Button
              variant="primary"
              disabled={busy || !destination || !acknowledged}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  const done = await api.publish(
                    tenant,
                    session.id,
                    { artifactId: artifact.id, workspaceId: destination, acknowledged },
                    requestId,
                  );
                  setReceipt(done.materialId);
                } catch (e) {
                  setError(message(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? '正在发布…' : '确认发布'}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={onDone}>
              取消
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

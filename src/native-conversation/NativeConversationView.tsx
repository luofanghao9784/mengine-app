import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowUpRight,
  Download,
  ExternalLink,
  FolderCog,
  Pause,
  Play,
  RefreshCw,
  Share2,
} from 'lucide-react';
import type { Workspace } from '../../contracts/public-api/identity';
import type {
  NativeArtifact,
  NativeConversation,
  NativeConversationGrant,
} from '../../contracts/public-api/native-conversations';
import { LiveConversationDeck } from '../conversation/LiveConversationDeck';
import { CardTypeTag } from '../conversation/CardTypeTag';
import { Button, Field, IconButton } from '../shared/ui';
import { IdentityError } from '../identity/client';
import { nativeConversationClient as api, openNativeWindow, reserveNativeWindow } from './client';
import { useNativeSessions, nativeHref } from './useNativeConversations';
import { nativeSessionTitle } from './labels';
import { NativeChat } from './chat/NativeChat';
import { useNativeFeed } from './chat/useNativeFeed';
import { buildTranscript } from './chat/transcript.ts';
import './native-conversation.css';

const oldConversationHref = (tenant: string, id: string) =>
  '#' + new URLSearchParams({ tenant, view: 'conversations', conversation: id });
/**
 * 在点击的同一时刻先占好新窗口（浏览器只允许这时弹出），拿到一次性授权后再把官方会话载入其中；
 * 请求失败就关掉这个空窗口。
 */
async function launchInto(grant: () => Promise<NativeConversationGrant>) {
  const target = reserveNativeWindow();
  try {
    openNativeWindow(await grant(), target.name);
  } catch (error) {
    target.close();
    throw error;
  }
}
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

/**
 * 原生会话在梦擎会话页里的视图。执行在官方 DH 会话窗口里进行（关掉本页不影响任务）；
 * 这里负责开启 / 停止 / 继续、私人成果与员工确认发布。所有状态都来自服务端回执。
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
  // 平台接通事件转发（B1）后，会话直接在这张卡片里进行；在此之前保持“执行与成果”的现有布局。
  const feed = useNativeFeed(tenant, id);
  const transcript = useMemo(() => (feed ? buildTranscript(feed.events) : null), [feed]);
  const [manageOpen, setManageOpen] = useState(true);
  const chat = !!(feed && transcript && session);
  const title = isNew
    ? '新建原生会话'
    : transcript?.title || (session ? nativeSessionTitle(session, titles) : '原生会话');
  const status = isNew
    ? '企业资料与权限沿用梦擎；执行在官方会话窗口中进行'
    : session
      ? session.state === 'ACTIVE'
        ? chat
          ? '可继续'
          : '可继续 · 执行在官方会话窗口中进行'
        : '已停止 · 执行授权已撤销'
      : '';
  const detail = session && (
    <NativeSessionDetail
      tenant={tenant}
      session={session}
      workspaces={workspaces}
      legacyTitle={session.legacyConversationId ? titles.get(session.legacyConversationId) : undefined}
      onChanged={refresh}
    />
  );
  return (
    <LiveConversationDeck
      tenant={tenant}
      navigation={navigation}
      persistenceKey={`native:${id}`}
      title={title}
      heading={
        <>
          <h2 title={title}>{title}</h2>
          {status && <p>{status}</p>}
        </>
      }
      headerActions={
        chat && !manageOpen ? (
          <IconButton icon={FolderCog} label="执行与成果" onClick={() => setManageOpen(true)} />
        ) : undefined
      }
      onClose={() => {
        location.hash = '#tenant=' + tenant + '&view=briefing';
      }}
      cards={
        chat && manageOpen
          ? [
              {
                id: 'native-manage',
                kind: 'file',
                title: '执行与成果',
                label: '执行与成果',
                content: <div className="native-reader-body">{detail}</div>,
                close: () => setManageOpen(false),
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
            {status && <p className="muted">{status}</p>}
          </div>
        </header>
        {chat && feed && transcript ? (
          <>
            {feed.preview && (
              <p className="native-preview-banner" role="note">
                预览数据：用于在本地查看界面，不是真实会话，操作不会发送到服务器。
              </p>
            )}
            <NativeChat transcript={transcript} status={feed.status} actions={feed.actions} />
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
            ) : !session ? (
              <p className="native-note">找不到这个原生会话，或你已没有它所在空间的访问权限。</p>
            ) : (
              detail
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
        原生会话使用完整的官方 DH
        能力：长任务、工具过程、停止后继续和成果文件。企业资料仍按你在梦擎的权限读取，生成的文件先保存在你的私人成果里，经你确认才会发布到共享空间。
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
          icon={ExternalLink}
          disabled={busy || !space}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await launchInto(async () => {
                const created = await api.open(tenant, space, previous || null, requestId);
                onCreated(created);
                return api.grant(tenant, created.id);
              });
            } catch (e) {
              setError(message(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? '正在创建…' : '创建并打开官方会话'}
        </Button>
      </div>
    </div>
  );
}

function NativeSessionDetail({
  tenant,
  session,
  workspaces,
  legacyTitle,
  onChanged,
}: {
  tenant: string;
  session: NativeConversation;
  workspaces: Workspace[];
  legacyTitle?: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const run = async (work: () => Promise<string | void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const done = await work();
      if (done) setNotice(done);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const active = session.state === 'ACTIVE';
  return (
    <>
      <div className="native-section">
        <h3>会话执行</h3>
        <p className="native-note">
          {active
            ? '对话、工具过程和长任务都在官方会话窗口里进行。关掉梦擎页面不会中断正在执行的任务；重复打开也不会结束它。'
            : '这个会话已停止，执行授权已撤销。继续后会沿用原来的会话记录、预算和工作文件。'}
        </p>
        <div className="native-actions">
          {active ? (
            <>
              <Button
                variant="primary"
                icon={ExternalLink}
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await launchInto(() => api.grant(tenant, session.id));
                    return '已在新窗口打开官方会话。';
                  })
                }
              >
                打开官方会话
              </Button>
              <Button
                icon={Pause}
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api.stop(tenant, session.id);
                    onChanged();
                    return '已停止：执行授权已撤销，运行环境会在下一次权限检查时关闭。';
                  })
                }
              >
                停止
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              icon={Play}
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await launchInto(async () => {
                    const resumed = await api.resume(tenant, session.id);
                    onChanged();
                    return api.grant(tenant, resumed.id);
                  });
                  return '已继续原会话，并在新窗口打开。';
                })
              }
            >
              继续原会话
            </Button>
          )}
        </div>
        {session.legacyConversationId && (
          <p className="native-note">
            接续自旧会话
            <a href={oldConversationHref(tenant, session.legacyConversationId)}>
              {legacyTitle ? `「${legacyTitle}」` : '（查看旧会话）'}
              <ArrowUpRight size={13} aria-hidden="true" />
            </a>
            ，旧会话仍可在原处打开。
          </p>
        )}
        {notice && (
          <p className="native-notice" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className="native-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <NativeArtifacts tenant={tenant} session={session} workspaces={workspaces} />
    </>
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
    <div className="native-section">
      <div className="native-section-head">
        <h3>私人成果</h3>
        <Button variant="ghost" icon={RefreshCw} onClick={() => setAttempt((x) => x + 1)}>
          刷新
        </Button>
      </div>
      <p className="native-note">只有保存成功并拿到平台回执的文件才会出现在这里，只有你能看到。</p>
      {loadError ? (
        <p className="native-error" role="alert">
          {loadError}
        </p>
      ) : files === null ? (
        <p className="platform-loading" role="status">
          正在读取…
        </p>
      ) : !files.length ? (
        <p className="native-empty">还没有成果文件。会话里生成并保存的文件会出现在这里。</p>
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
    </div>
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

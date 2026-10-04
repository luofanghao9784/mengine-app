import { adminHref } from '../admin/navigation';
import { LibraryToolbar } from './LibraryToolbar';
import { SharedActivity } from '../activity/Activity';
import { ContinueWithMaterial } from '../conversation/AttachmentMaterials';
import { DocumentCard } from '../documents/Documents';
import { useViewState, textState, pageState } from '../shared/useViewState';
import { LiveConversationDeck } from '../conversation/LiveConversationDeck';
import { MoreActions } from '../shared/MoreActions';
import { ExportBatchPanel } from '../export/ExportBatchPanel';
import { requestNavigationLocked } from '../shared/request-guard';
import { useEffect, useRef, useState } from 'react';
import {
  Info,
  FileText,
  Folder,
  FolderPlus,
  Upload,
  Download,
  ChevronRight,
  RefreshCw,
  LibraryBig,
} from 'lucide-react';
import type { TenantContext } from '../../contracts/public-api/identity';
import type { MaterialEntry, MaterialVersion } from '../../contracts/public-api/material';
import { useSession, identityClient } from '../identity/session';
import { IdentityError, uuid } from '../identity/client';
import { Button, Badge, Empty, Field, Modal, PageActions, IconButton } from '../shared/ui';
import { Failure, Loading, Pager, useRemote, useSubmission, SubmitError } from '../shared/admin';
import { materialClient as api } from './client';
import './material.css';
import { AnalysisPanel, ContentSearch } from './Knowledge';
import { MaterialUploadDialog } from './BatchUpload';
import { useUploads } from './UploadManager';
import { MaterialMaintenance } from '../lifecycle/MaterialMaintenance';
export const libraryHref = (tenant: string, scope = 'personal', folder?: string) =>
  '#' + new URLSearchParams({ tenant, view: 'library', scope, ...(folder ? { folder } : {}) });
const size = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1048576
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1048576).toFixed(1)} MB`;
const message = (error: unknown) =>
  error instanceof IdentityError ? error.message : '请求未完成，请稍后重试。';
const accessDenied = (error: unknown) =>
  error instanceof IdentityError && [401, 403, 404].includes(error.status);
export function LiveLibrary({
  tenant,
  administration = false,
}: {
  tenant: string;
  administration?: boolean;
}) {
  const { session } = useSession();
  const [attempt, setAttempt] = useState(0);
  const context = useRemote(
    (signal) => identityClient.context(tenant, signal),
    [tenant, attempt, session.identity],
  );
  return context.error ? (
    <Failure error={context.error} retry={() => setAttempt((x) => x + 1)} />
  ) : !context.value ? (
    <Loading />
  ) : (
    <LibraryContents tenant={tenant} context={context.value} administration={administration} />
  );
}

function LibraryContents({
  tenant,
  context,
  administration = false,
}: {
  tenant: string;
  context: TenantContext;
  administration?: boolean;
}) {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const change = () => {
      if (!requestNavigationLocked()) setHash(location.hash);
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  const params = new URLSearchParams(hash.slice(1)),
    scope = params.get('scope') || (administration ? 'enterprise' : 'personal'),
    folder = params.get('folder');
  const selected =
    scope === 'personal'
      ? context.workspaces.find((s) => s.kind === 'PERSONAL')
      : context.workspaces.find((s) => s.id === scope);
  const enterprise = scope === 'enterprise',
    all = scope === 'all';
  const allowed =
    (enterprise || all || !!selected) &&
    (!administration || enterprise || all || selected?.kind === 'SHARED');
  return (
    <>
      {!administration && (
        <PageActions>
          <div className="material-tabs" aria-label="资料范围">
            <Button
              variant={selected?.kind === 'PERSONAL' ? 'primary' : 'ghost'}
              onClick={() => {
                location.hash = libraryHref(tenant);
              }}
            >
              个人空间
            </Button>
            <Button
              variant={selected?.kind === 'SHARED' || enterprise || all ? 'primary' : 'ghost'}
              onClick={() => {
                location.hash = libraryHref(tenant, 'enterprise');
              }}
            >
              企业资料库
            </Button>
          </div>
        </PageActions>
      )}
      {!allowed || (folder && !uuid(folder)) ? (
        <Empty icon={Folder} title="此位置暂不可用" text="空间或文件夹不存在，或你没有查看权限。" />
      ) : (
        <LibraryListing
          key={`${scope}:${folder || ''}`}
          tenant={tenant}
          context={context}
          workspace={selected?.id || null}
          folder={folder}
          enterprise={enterprise}
          all={all}
          administration={administration}
          hash={hash}
        />
      )}
    </>
  );
}
function LibraryListing({
  tenant,
  context,
  workspace,
  folder,
  enterprise,
  all,
  administration,
  hash,
}: {
  tenant: string;
  context: TenantContext;
  workspace: string | null;
  folder: string | null;
  enterprise: boolean;
  all: boolean;
  administration: boolean;
  hash: string;
}) {
  const href = (tenant: string, scope = 'personal', folder?: string) =>
    administration
      ? adminHref('tenant', 'materials', hash, { section: 'files', scope, ...(folder ? { folder } : {}) })
      : libraryHref(tenant, scope, folder);
  const [draftDocument, setDraftDocument] = useState<string>();
  const [contentSearch, setContentSearch] = useState(false);
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const listingKey =
    (administration ? 'admin-library:' : 'library:') +
    (workspace || (all ? 'all' : 'enterprise')) +
    ':' +
    (folder || 'root');
  const [query, setQuery] = useViewState(tenant, listingKey + ':input', '', textState);
  const [q, setQ] = useViewState(tenant, listingKey + ':query', '', textState);
  const [page, setPage] = useViewState(tenant, listingKey + ':page', 0, pageState);
  const [attempt, setAttempt] = useState(0);
  const { queue } = useUploads();
  const savedUploads = queue.jobs.reduce(
    (n, job) => n + job.run.files.filter((row) => row.state === 'succeeded').length,
    0,
  );
  useEffect(() => {
    setAttempt((n) => n + 1);
  }, [savedUploads]);
  const [layout, setLayout] = useViewState<'cards' | 'list'>(
    tenant,
    administration ? 'admin-library:layout' : 'library:layout',
    'cards',
    (v): v is 'cards' | 'list' => v === 'cards' || v === 'list',
  );
  const [modal, setModal] = useState<'folder' | 'upload'>();
  const [document, setDocument] = useViewState<Pick<MaterialEntry, 'id' | 'workspaceId'> | null>(
    tenant,
    listingKey + ':document',
    null,
    (v): v is Pick<MaterialEntry, 'id' | 'workspaceId'> | null =>
      v === null ||
      (!!v && typeof v === 'object' && 'id' in v && 'workspaceId' in v && uuid(v.id) && uuid(v.workspaceId)),
  );
  const [notice, setNotice] = useState('');
  const data = useRemote(
    (signal) => api.list(tenant, workspace, folder, q, page * 24, signal),
    [tenant, workspace, folder, q, page, attempt, context],
  );
  const current = context.workspaces.find((s) => s.id === workspace);
  const [uploadTarget, setUploadTarget] = useState(workspace || '');
  const refresh = () => setAttempt((x) => x + 1);
  const completed = (text: string) => {
    setModal(undefined);
    setNotice(text);
    refresh();
  };
  const denied = (error: unknown) => {
    setModal(undefined);
    setNotice(message(error));
    refresh();
  };
  useEffect(() => {
    // Keep forms during a background check (including native file-picker focus),
    // but close them once a completed check says the location is unavailable or read-only.
    if (
      modal &&
      (data.error ||
        (workspace && data.value && !data.value.canMaintain) ||
        (uploadTarget && !context.workspaces.some((s) => s.id === uploadTarget)))
    ) {
      setModal(undefined);
      setNotice(message(data.error || new IdentityError('MATERIAL_READ_ONLY', 403)));
    }
  }, [data.error, data.value, workspace, modal, uploadTarget, context]);
  useEffect(() => {
    if (data.error || (data.value && !data.value.canMaintain)) setMaintenanceOpen(false);
    if (data.error) setActivityOpen(false);
  }, [data.error, data.value]);
  const personal = current?.kind === 'PERSONAL';
  return (
    <>
      {current?.kind === 'SHARED' && (
        <ExportBatchPanel
          tenant={tenant}
          workspace={current.id}
          workspaceName={current.name}
          scope="ENTERPRISE"
        />
      )}
      <PageActions>
        <MoreActions label="资料操作">
          {(enterprise || all || current?.kind === 'SHARED') && (
            <Button onClick={() => setActivityOpen(true)}>资料动态</Button>
          )}
          <Button variant="ghost" icon={RefreshCw} onClick={refresh}>
            刷新
          </Button>
          {workspace && data.value?.canMaintain && (
            <Button onClick={() => setMaintenanceOpen(true)}>维护与回收站</Button>
          )}
          {data.value?.canMaintain && (
            <Button icon={FolderPlus} onClick={() => setModal('folder')}>
              新建文件夹
            </Button>
          )}
        </MoreActions>
        {(data.value?.canMaintain || enterprise || all) && (
          <Button
            variant="primary"
            icon={Upload}
            onClick={() => {
              setUploadTarget(workspace || '');
              setModal('upload');
            }}
          >
            上传资料
          </Button>
        )}
      </PageActions>
      <LibraryToolbar
        query={query}
        onQuery={setQuery}
        layout={layout}
        onLayout={setLayout}
        onSearch={() => {
          setQ(query.trim());
          setPage(0);
        }}
        onClear={() => {
          setQuery('');
          setQ('');
          setPage(0);
        }}
      >
        {(folder || all || (current && !personal)) && (
          <nav className="material-crumbs" aria-label="文件夹路径">
            <button
              onClick={() => {
                location.hash = href(tenant, personal ? 'personal' : 'enterprise');
              }}
            >
              {personal ? '个人空间' : '企业资料库'}
            </button>
            {current && !personal && (
              <>
                <ChevronRight size={14} />
                <button
                  onClick={() => {
                    location.hash = href(tenant, workspace!);
                  }}
                >
                  {current.name}
                </button>
              </>
            )}
            {all && (
              <>
                <ChevronRight size={14} />
                <span>全部资料</span>
              </>
            )}
            {data.value?.trail.map((c) => (
              <span key={c.id}>
                <ChevronRight size={14} />
                <button
                  onClick={() => {
                    location.hash = href(tenant, personal ? 'personal' : workspace!, c.id);
                  }}
                >
                  {c.name}
                </button>
              </span>
            ))}
          </nav>
        )}
      </LibraryToolbar>
      {activityOpen && (enterprise || all || current?.kind === 'SHARED') && (
        <Modal title="资料动态" onClose={() => setActivityOpen(false)}>
          <SharedActivity
            key={workspace || 'enterprise'}
            tenant={tenant}
            context={context}
            workspace={current?.kind === 'SHARED' ? current.id : undefined}
            embedded
          />
        </Modal>
      )}
      {notice && (
        <p className="access-success" role="status">
          {notice}
        </p>
      )}
      {enterprise && !q && (
        <>
          <div className="material-section">
            <h2>共享空间</h2>
            <Button
              variant="ghost"
              onClick={() => {
                location.hash = href(tenant, 'all');
              }}
            >
              全部资料
            </Button>
          </div>
          <div className="material-grid">
            {context.workspaces
              .filter((s) => s.kind === 'SHARED')
              .map((s) => (
                <button
                  key={s.id}
                  className="material-space-card"
                  onClick={() => {
                    location.hash = href(tenant, s.id);
                  }}
                >
                  <Folder size={28} />
                  <strong>{s.name}</strong>
                  <ChevronRight size={16} />
                </button>
              ))}
          </div>
          {!context.workspaces.some((s) => s.kind === 'SHARED') && (
            <Empty icon={Folder} title="还没有共享空间" text="企业管理员授权后，共享资料会显示在这里。" />
          )}
          <div className="material-section">
            <h2>最近更新</h2>
          </div>
        </>
      )}
      {data.error ? (
        <Failure error={data.error} retry={refresh} />
      ) : !data.value ? (
        <Loading />
      ) : (
        <>
          {workspace && (
            <p className="material-caption">
              {data.value.canMaintain ? '可上传与维护' : '只读 · 可查看与下载'}
              {q ? ' · 搜索名称与正文，包含当前目录及子目录' : ''}
            </p>
          )}
          <div className={`material-entries ${layout}`}>
            {data.value.items.map((item) => (
              <button
                key={item.id}
                className="material-entry"
                onClick={() =>
                  item.kind === 'FOLDER'
                    ? (location.hash = href(tenant, personal ? 'personal' : item.workspaceId, item.id))
                    : item.kind === 'DRAFT'
                      ? setDraftDocument(item.id)
                      : setDocument({ id: item.id, workspaceId: item.workspaceId })
                }
              >
                <div className="material-cover">
                  {item.kind === 'FOLDER' ? <Folder size={32} /> : <FileText size={32} />}
                  <span>
                    {item.kind === 'FOLDER'
                      ? '文件夹'
                      : item.kind === 'DRAFT'
                        ? '文稿'
                        : item.name.includes('.')
                          ? item.name.split('.').at(-1)?.toUpperCase()
                          : '文件'}
                  </span>
                  {item.kind === 'DOCUMENT' && <strong>{item.name}</strong>}
                </div>
                <div className="material-entry-body">
                  <strong>{item.name}</strong>
                  <small>
                    {q || !workspace
                      ? item.path.join(' / ')
                      : item.kind === 'DOCUMENT'
                        ? `${size(item.sizeBytes!)} · v${item.version}`
                        : '打开文件夹'}
                  </small>
                  <small>
                    {new Date(item.updatedAt).toLocaleDateString('zh-CN')}
                    {item.kind === 'DOCUMENT' ? ' · 原件已保存' : ''}
                  </small>
                </div>
              </button>
            ))}
          </div>
          {!data.value.items.length && (
            <Empty
              icon={LibraryBig}
              title={q ? '没有找到资料' : '还没有资料'}
              text={
                data.value.canMaintain ? '可上传原文件，或先新建文件夹。' : '这里仅显示你有权查看的资料。'
              }
            />
          )}
          {(page > 0 || data.value.hasMore) && (
            <Pager page={page} next={data.value.hasMore} onPage={setPage} />
          )}
        </>
      )}
      {contentSearch && (
        <ContentSearch
          tenant={tenant}
          space={workspace}
          close={() => setContentSearch(false)}
          verification={context}
        />
      )}
      {maintenanceOpen && workspace && (
        <MaterialMaintenance
          tenant={tenant}
          workspace={workspace}
          entries={data.value?.items || []}
          verification={context}
          close={() => setMaintenanceOpen(false)}
          changed={refresh}
        />
      )}
      {modal === 'folder' && workspace && (
        <FolderDialog
          tenant={tenant}
          workspace={workspace}
          parent={folder}
          close={() => setModal(undefined)}
          completed={() => completed('文件夹已创建。')}
          denied={denied}
        />
      )}
      {modal === 'upload' && (
        <MaterialUploadDialog
          tenant={tenant}
          workspace={uploadTarget}
          parent={workspace ? folder : null}
          workspaceName={context.workspaces.find((space) => space.id === uploadTarget)?.name || ''}
          scope={personal ? 'personal' : uploadTarget}
          close={() => setModal(undefined)}
        >
          {!workspace && (
            <Field label="保存到共享空间" hint="仅具备资料维护权限时可以上传。">
              <select required value={uploadTarget} onChange={(e) => setUploadTarget(e.target.value)}>
                <option value="">请选择空间</option>
                {context.workspaces
                  .filter((s) => s.kind === 'SHARED')
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </Field>
          )}
        </MaterialUploadDialog>
      )}
      {draftDocument && (
        <DocumentCard tenant={tenant} id={draftDocument} close={() => setDraftDocument(undefined)} />
      )}
      {document && (
        <DocumentDialog
          key={document.id}
          tenant={tenant}
          entry={document}
          maxBytes={data.value?.maxUploadBytes || 20971520}
          close={() => setDocument(null)}
          changed={refresh}
          verification={context}
          administration={administration}
        />
      )}
    </>
  );
}
function FolderDialog({
  tenant,
  workspace,
  parent,
  close,
  completed,
  denied,
}: {
  tenant: string;
  workspace: string;
  parent: string | null;
  close: () => void;
  completed: () => void;
  denied: (error: unknown) => void;
}) {
  const [name, setName] = useState('');
  const submit = useSubmission<{ name: string }>();
  const controller = useRef(new AbortController());
  useEffect(() => () => controller.current.abort(), []);
  return (
    <Modal
      title="新建文件夹"
      onClose={() => {
        if (!submit.busy) close();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit.submit({ name: name.trim() }, async (body, requestId) => {
            try {
              await api.folder(
                tenant,
                workspace,
                { ...body, requestId, parentId: parent },
                controller.current.signal,
              );
              if (!controller.current.signal.aborted) completed();
            } catch (error) {
              if (!controller.current.signal.aborted && accessDenied(error)) denied(error);
              throw error;
            }
          });
        }}
      >
        <fieldset disabled={submit.busy || submit.uncertain}>
          <Field label="文件夹名称">
            <input value={name} maxLength={180} required onChange={(e) => setName(e.target.value)} />
          </Field>
        </fieldset>
        <SubmitError error={submit.error} uncertain={submit.uncertain} />
        <Button type="submit" variant="primary" disabled={submit.busy}>
          {submit.busy ? '正在创建…' : submit.uncertain ? '重试本次创建' : '创建文件夹'}
        </Button>
      </form>
    </Modal>
  );
}
function UploadDialog({
  tenant,
  workspace,
  folder,
  document,
  expectedVersion,
  maxBytes,
  children,
  close,
  completed,
  denied,
}: {
  tenant: string;
  workspace: string;
  folder: string | null;
  document?: string;
  expectedVersion?: number;
  maxBytes: number;
  children?: React.ReactNode;
  close: () => void;
  completed: () => void;
  denied: (error: unknown) => void;
}) {
  const [file, setFile] = useState<File>(),
    [validation, setValidation] = useState('');
  const submit = useSubmission<{ workspace: string; file: File }>();
  const controller = useRef(new AbortController());
  useEffect(() => () => controller.current.abort(), []);
  return (
    <Modal
      title={document ? '上传新版本' : '上传资料'}
      onClose={() => {
        if (!submit.busy) close();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!file || !workspace) return;
          if (file.size > maxBytes) {
            setValidation(`本环境单文件上限为 ${size(maxBytes)}。`);
            return;
          }
          setValidation('');
          void submit.submit({ workspace, file }, async (body, requestId) => {
            try {
              await api.upload(
                tenant,
                body.workspace,
                { requestId, ...(document ? { expectedVersion } : { folderId: folder }) },
                body.file,
                document,
                controller.current.signal,
              );
              if (!controller.current.signal.aborted) completed();
            } catch (error) {
              if (!controller.current.signal.aborted && accessDenied(error)) denied(error);
              throw error;
            }
          });
        }}
      >
        <fieldset disabled={submit.busy || submit.uncertain}>
          {children}
          <Field label="选择文件" hint={`单文件不超过 ${size(maxBytes)}；保留原件，支持的格式会在后台解析。`}>
            <input type="file" required onChange={(e) => setFile(e.target.files?.[0])} />
          </Field>
        </fieldset>
        {document && (
          <p className="muted">将基于 v{expectedVersion} 新增版本，已有版本和下载来源继续保留。</p>
        )}
        {validation && (
          <p className="access-alert" role="alert">
            {validation}
          </p>
        )}
        <SubmitError error={submit.error} uncertain={submit.uncertain} />
        <Button type="submit" variant="primary" icon={Upload} disabled={submit.busy || !file || !workspace}>
          {submit.busy
            ? '正在上传…'
            : submit.uncertain
              ? '重试本次上传'
              : document
                ? '上传新版本'
                : '保存原文件'}
        </Button>
      </form>
    </Modal>
  );
}
export function DocumentDialog({
  tenant,
  entry,
  maxBytes,
  close,
  changed,
  verification,
  administration = false,
}: {
  tenant: string;
  entry: Pick<MaterialEntry, 'id' | 'workspaceId'>;
  maxBytes: number;
  close: () => void;
  changed: () => void;
  verification: TenantContext;
  administration?: boolean;
}) {
  const { session, expire } = useSession();
  const [page, setPage] = useState(0),
    [attempt, setAttempt] = useState(0),
    [upload, setUpload] = useState<number>();
  const readerKey = (administration ? 'admin:' : '') + 'material:' + entry.workspaceId + ':' + entry.id;
  const [analysis, setAnalysis] = useViewState<MaterialVersion | null>(
    tenant,
    readerKey + ':version',
    null,
    (v): v is MaterialVersion | null =>
      v === null ||
      (!!v &&
        typeof v === 'object' &&
        'id' in v &&
        uuid(v.id) &&
        'number' in v &&
        Number.isSafeInteger(v.number) &&
        'filename' in v &&
        typeof v.filename === 'string'),
  );
  const [properties, setProperties] = useViewState(
    tenant,
    readerKey + ':properties',
    administration,
    (v): v is boolean => typeof v === 'boolean',
  );
  const [reveal, setReveal] = useState<{ id: string; sequence: number }>();
  const [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  const [denial, setDenial] = useState<unknown>();
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const data = useRemote(
    (signal) => api.detail(tenant, entry.workspaceId, entry.id, page * 20, signal),
    [tenant, entry.workspaceId, entry.id, page, attempt, session.identity, verification],
  );
  const failure = denial || data.error;
  useEffect(() => {
    if (failure) {
      controller.current?.abort();
      setBusy(false);
    }
    if (upload !== undefined && (failure || (data.value && !data.value.document.canMaintain))) {
      setUpload(undefined);
      if (!failure) setError(new IdentityError('MATERIAL_READ_ONLY', 403));
    }
  }, [failure, data.value, upload]);
  const download = async (version: MaterialVersion) => {
    if (busy) return;
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setError(undefined);
    try {
      const blob = await api.download(tenant, entry.workspaceId, entry.id, version.id, request.signal);
      if (request.signal.aborted) return;
      const url = URL.createObjectURL(blob),
        link = document.createElement('a');
      link.href = url;
      link.download = version.filename;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      if (request.signal.aborted) return;
      if (e instanceof IdentityError && e.status === 401) expire();
      else if (accessDenied(e)) {
        setDenial(e);
        changed();
      } else setError(e);
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  };
  const uploadDialog =
    upload !== undefined ? (
      <UploadDialog
        tenant={tenant}
        workspace={entry.workspaceId}
        folder={null}
        document={entry.id}
        expectedVersion={upload}
        maxBytes={maxBytes}
        close={() => setUpload(undefined)}
        denied={(error) => {
          setUpload(undefined);
          if (error instanceof IdentityError && error.code === 'MATERIAL_READ_ONLY') {
            setError(error);
            setAttempt((x) => x + 1);
          } else setDenial(error);
          changed();
        }}
        completed={() => {
          setUpload(undefined);
          setAttempt((x) => x + 1);
          setPage(0);
          changed();
        }}
      />
    ) : null;
  const selectedVersion = analysis || data.value?.versions[0];
  useEffect(() => {
    if (!analysis && data.value?.versions[0]) setAnalysis(data.value.versions[0]);
  }, [analysis, data.value]);
  const refreshReader = () => {
    setDenial(undefined);
    setAttempt((x) => x + 1);
  };
  const title = data.value?.document.name || '资料';
  const unavailable = failure ? <Failure error={failure} retry={refreshReader} /> : <Loading />;
  return (
    <>
      <Modal
        title="资料与历史版本"
        onClose={() => {
          if (!requestNavigationLocked()) close();
        }}
        wide
        className="live-library-deck-modal"
      >
        <LiveConversationDeck
          tenant={tenant}
          reader
          persistenceKey={readerKey}
          title={title}
          onClose={close}
          onRefresh={refreshReader}
          reveal={reveal}
          mainActions={
            !failure &&
            data.value && (
              <IconButton
                icon={Info}
                label="查看资料属性与版本"
                onClick={() => {
                  setProperties(true);
                  setReveal((previous) => ({ id: 'properties', sequence: (previous?.sequence || 0) + 1 }));
                }}
              />
            )
          }
          cards={
            properties
              ? [
                  {
                    id: 'properties',
                    kind: 'properties',
                    title,
                    label: '资料属性与版本',
                    parentId: 'conversation',
                    close: () => setProperties(false),
                    content:
                      failure || !data.value ? (
                        unavailable
                      ) : (
                        <>
                          <dl className="live-material-properties">
                            <dt>位置</dt>
                            <dd>{data.value.document.path.join(' / ')}</dd>
                            <dt>阅读版本</dt>
                            <dd>v{selectedVersion?.number}</dd>
                            <dt>当前最新版本</dt>
                            <dd>v{data.value.document.version}</dd>
                            <dt>权限</dt>
                            <dd>{data.value.document.canMaintain ? '可阅读、下载与维护' : '可阅读与下载'}</dd>
                          </dl>
                          {data.value.document.canMaintain && (
                            <Button icon={Upload} onClick={() => setUpload(data.value!.document.version)}>
                              上传新版本
                            </Button>
                          )}
                          <h3>历史版本</h3>
                          <ul className="material-versions">
                            {data.value.versions.map((v) => (
                              <li key={v.id}>
                                <div>
                                  <strong>
                                    v{v.number} · {v.filename}
                                  </strong>
                                  <small>
                                    {size(v.sizeBytes)} · {new Date(v.createdAt).toLocaleString('zh-CN')}
                                  </small>
                                  <details className="material-checksum">
                                    <summary>文件校验信息</summary>
                                    <small>SHA-256：{v.sha256}</small>
                                  </details>
                                </div>
                                <Button
                                  onClick={() => {
                                    setAnalysis(v);
                                    setReveal((previous) => ({
                                      id: 'conversation',
                                      sequence: (previous?.sequence || 0) + 1,
                                    }));
                                  }}
                                >
                                  查看 v{v.number} 解析
                                </Button>
                                <Button icon={Download} disabled={busy} onClick={() => void download(v)}>
                                  下载 v{v.number}
                                </Button>
                              </li>
                            ))}
                          </ul>
                          {(page > 0 || data.value.hasMore) && (
                            <Pager page={page} next={data.value.hasMore} onPage={setPage} />
                          )}
                        </>
                      ),
                  },
                ]
              : []
          }
        >
          {failure || !data.value
            ? unavailable
            : selectedVersion && (
                <>
                  <div className="live-reader-version-bar">
                    <Badge>v{selectedVersion.number}</Badge>
                    {!administration && (
                      <ContinueWithMaterial
                        tenant={tenant}
                        space={entry.workspaceId}
                        material={entry.id}
                        version={selectedVersion.id}
                        close={close}
                      />
                    )}
                    <Button icon={Download} disabled={busy} onClick={() => void download(selectedVersion)}>
                      下载原件
                    </Button>
                  </div>
                  {error && (
                    <p className="access-alert" role="alert">
                      {message(error)}
                    </p>
                  )}
                  <AnalysisPanel
                    key={selectedVersion.id}
                    tenant={tenant}
                    space={entry.workspaceId}
                    material={entry.id}
                    version={selectedVersion.id}
                    verification={verification}
                  />
                </>
              )}
        </LiveConversationDeck>
      </Modal>
      {uploadDialog}
    </>
  );
}

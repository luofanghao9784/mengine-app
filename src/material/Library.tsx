import { documentsHref } from '../documents/routes';
import { useEffect, useRef, useState } from 'react';
import {
  FileText,
  Folder,
  FolderPlus,
  Upload,
  Download,
  ChevronRight,
  Grid2X2,
  List,
  Search,
  RefreshCw,
  LibraryBig,
} from 'lucide-react';
import type { TenantContext } from '../../contracts/public-api/identity';
import type { MaterialEntry, MaterialVersion } from '../../contracts/public-api/material';
import { useSession, identityClient } from '../identity/session';
import { IdentityError, uuid } from '../identity/client';
import { Button, Badge, Empty, Field, Modal, PageActions } from '../shared/ui';
import { Failure, Loading, Pager, useRemote, useSubmission, SubmitError } from '../shared/admin';
import { materialClient as api } from './client';
import './material.css';
import { AnalysisPanel, ContentSearch } from './Knowledge';
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
export function LiveLibrary({ tenant }: { tenant: string }) {
  const { session } = useSession();
  const [attempt, setAttempt] = useState(0);
  const { expire } = useSession();
  const [context, setContext] = useState<{ value?: TenantContext; error?: unknown }>({});
  useEffect(() => {
    const controller = new AbortController();
    // A native file picker regains window focus; retain an in-progress form during background revalidation.
    identityClient
      .context(tenant, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setContext({ value });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (error instanceof IdentityError && error.status === 401) expire();
        else setContext({ error });
      });
    return () => controller.abort();
  }, [tenant, attempt, session.identity, expire]);
  return (
    <>
      <PageActions>
        <Button
          icon={FileText}
          onClick={() => {
            location.hash = documentsHref(tenant);
          }}
        >
          个人文稿
        </Button>
        <Button variant="ghost" icon={RefreshCw} onClick={() => setAttempt((x) => x + 1)}>
          刷新
        </Button>
      </PageActions>
      {context.error ? (
        <Failure error={context.error} retry={() => setAttempt((x) => x + 1)} />
      ) : !context.value ? (
        <Loading />
      ) : (
        <LibraryContents tenant={tenant} context={context.value} />
      )}
    </>
  );
}
function LibraryContents({ tenant, context }: { tenant: string; context: TenantContext }) {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const change = () => setHash(location.hash);
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  const params = new URLSearchParams(hash.slice(1)),
    scope = params.get('scope') || 'personal',
    folder = params.get('folder');
  const selected =
    scope === 'personal'
      ? context.workspaces.find((s) => s.kind === 'PERSONAL')
      : context.workspaces.find((s) => s.id === scope);
  const enterprise = scope === 'enterprise',
    all = scope === 'all';
  const allowed = enterprise || all || !!selected;
  return (
    <>
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
}: {
  tenant: string;
  context: TenantContext;
  workspace: string | null;
  folder: string | null;
  enterprise: boolean;
  all: boolean;
}) {
  const [contentSearch, setContentSearch] = useState(false);
  const [query, setQuery] = useState(''),
    [q, setQ] = useState(''),
    [page, setPage] = useState(0),
    [attempt, setAttempt] = useState(0);
  const [layout, setLayout] = useState<'cards' | 'list'>('cards');
  const [modal, setModal] = useState<'folder' | 'upload'>(),
    [document, setDocument] = useState<MaterialEntry>(),
    [notice, setNotice] = useState('');
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
  const personal = current?.kind === 'PERSONAL';
  return (
    <>
      <PageActions>
        {data.value?.canMaintain && (
          <Button icon={FolderPlus} onClick={() => setModal('folder')}>
            新建文件夹
          </Button>
        )}
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
      <div className="material-toolbar">
        <nav className="material-crumbs" aria-label="文件夹路径">
          <button
            onClick={() => {
              location.hash = libraryHref(tenant, personal ? 'personal' : 'enterprise');
            }}
          >
            {personal ? '个人空间' : '企业资料库'}
          </button>
          {current && !personal && (
            <>
              <ChevronRight size={14} />
              <button
                onClick={() => {
                  location.hash = libraryHref(tenant, workspace!);
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
                  location.hash = libraryHref(tenant, personal ? 'personal' : workspace!, c.id);
                }}
              >
                {c.name}
              </button>
            </span>
          ))}
        </nav>
        <div className="material-controls">
          <Button icon={Search} onClick={() => setContentSearch(true)}>
            搜索内容
          </Button>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setQ(query.trim());
              setPage(0);
            }}
          >
            <Search size={16} />
            <input
              aria-label="搜索资料名称"
              placeholder={workspace ? '搜索当前空间资料' : '搜索企业资料'}
              value={query}
              maxLength={180}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Button type="submit">搜索</Button>
          </form>
          <Button
            aria-label="卡片视图"
            aria-pressed={layout === 'cards'}
            icon={Grid2X2}
            onClick={() => setLayout('cards')}
          />
          <Button
            aria-label="列表视图"
            aria-pressed={layout === 'list'}
            icon={List}
            onClick={() => setLayout('list')}
          />
        </div>
      </div>
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
                location.hash = libraryHref(tenant, 'all');
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
                    location.hash = libraryHref(tenant, s.id);
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
              {q ? ' · 搜索范围为当前整个空间' : ''}
            </p>
          )}
          <div className={`material-entries ${layout}`}>
            {data.value.items.map((item) => (
              <button
                key={item.id}
                className="material-entry"
                onClick={() =>
                  item.kind === 'FOLDER'
                    ? (location.hash = libraryHref(tenant, personal ? 'personal' : item.workspaceId, item.id))
                    : setDocument(item)
                }
              >
                <div className="material-cover">
                  {item.kind === 'FOLDER' ? <Folder size={32} /> : <FileText size={32} />}
                  <span>
                    {item.kind === 'FOLDER'
                      ? '文件夹'
                      : item.name.includes('.')
                        ? item.name.split('.').at(-1)?.toUpperCase()
                        : '文件'}
                  </span>
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
          <Pager page={page} next={data.value.hasMore} onPage={setPage} />
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
        <UploadDialog
          tenant={tenant}
          workspace={uploadTarget}
          folder={workspace ? folder : null}
          maxBytes={data.value?.maxUploadBytes || 20971520}
          close={() => setModal(undefined)}
          completed={() => completed('原文件已保存；可在版本详情查看解析状态。')}
          denied={denied}
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
        </UploadDialog>
      )}
      {document && (
        <DocumentDialog
          key={document.id}
          tenant={tenant}
          entry={document}
          maxBytes={data.value?.maxUploadBytes || 20971520}
          close={() => setDocument(undefined)}
          changed={refresh}
          verification={context}
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
function DocumentDialog({
  tenant,
  entry,
  maxBytes,
  close,
  changed,
  verification,
}: {
  tenant: string;
  entry: MaterialEntry;
  maxBytes: number;
  close: () => void;
  changed: () => void;
  verification: TenantContext;
}) {
  const { session, expire } = useSession();
  const [page, setPage] = useState(0),
    [attempt, setAttempt] = useState(0),
    [upload, setUpload] = useState<number>();
  const [analysis, setAnalysis] = useState<MaterialVersion>();
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
  if (upload !== undefined)
    return (
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
    );
  return (
    <Modal title="资料与历史版本" onClose={close} wide>
      {failure ? (
        <Failure
          error={failure}
          retry={() => {
            setDenial(undefined);
            setAttempt((x) => x + 1);
          }}
        />
      ) : !data.value ? (
        <Loading />
      ) : (
        <>
          <div className="material-detail-heading">
            <FileText size={30} />
            <div>
              <h2>{data.value.document.name}</h2>
              <p>{data.value.document.path.join(' / ')}</p>
            </div>
            <Badge>v{data.value.document.version}</Badge>
          </div>
          <p className="material-caption">
            原件已保存。可查看各版本的解析内容；下载后可使用本机应用编辑，再上传新版本。
          </p>
          {data.value.document.canMaintain && (
            <Button icon={Upload} onClick={() => setUpload(data.value!.document.version)}>
              上传新版本
            </Button>
          )}
          {error && (
            <p className="access-alert" role="alert">
              {message(error)}
            </p>
          )}
          <ul className="material-versions">
            {data.value.versions.map((v) => (
              <li key={v.id}>
                <div>
                  <strong>
                    v{v.number} · {v.filename}
                    {v.origin === 'DOCUMENT_PUBLICATION' ? ' · 文稿发布' : ''}
                  </strong>
                  <small>
                    {size(v.sizeBytes)} · {new Date(v.createdAt).toLocaleString('zh-CN')}
                  </small>
                  <details className="material-checksum">
                    <summary>文件校验信息</summary>
                    <small>SHA-256：{v.sha256}</small>
                  </details>
                </div>
                <Button onClick={() => setAnalysis(analysis?.id === v.id ? undefined : v)}>
                  查看 v{v.number} 解析
                </Button>
                <Button icon={Download} disabled={busy} onClick={() => void download(v)}>
                  下载 v{v.number}
                </Button>
              </li>
            ))}
          </ul>
          <Pager page={page} next={data.value.hasMore} onPage={setPage} />
          {analysis && (
            <p className="material-caption">
              当前预览：v{analysis.number} · {analysis.filename}
            </p>
          )}
          {analysis && (
            <AnalysisPanel
              key={analysis.id}
              tenant={tenant}
              space={entry.workspaceId}
              material={entry.id}
              version={analysis.id}
              verification={verification}
            />
          )}
        </>
      )}
    </Modal>
  );
}

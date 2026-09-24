import { useState } from 'react';
import { Folder, FileText, Share2 } from 'lucide-react';
import type {
  DocumentVersion,
  DocumentPublication,
  PublishDocument,
} from '../../contracts/public-api/document';
import type { MaterialEntry } from '../../contracts/public-api/material';
import { identityClient, useSession } from '../identity/session';
import { materialClient } from '../material/client';
import { libraryHref } from '../material/Library';
import { Button, Field, Modal } from '../shared/ui';
import { Failure, Loading, Pager, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { publicationClient as api } from './publication-client';

export function PublicationPanel({
  tenant,
  id,
  version,
  disabled,
}: {
  tenant: string;
  id: string;
  version: DocumentVersion;
  disabled: boolean;
}) {
  const { session } = useSession();
  const [open, setOpen] = useState(false),
    [attempt, setAttempt] = useState(0),
    [page, setPage] = useState(0),
    [receipt, setReceipt] = useState<DocumentPublication>();
  const history = useRemote(
    (signal) => api.list(tenant, id, page, signal),
    [tenant, id, page, attempt, session.identity, version],
  );
  return (
    <section className="document-publications">
      <Button icon={Share2} disabled={disabled} onClick={() => setOpen(true)}>
        发布到企业资料库
      </Button>
      <p className="muted">只发布选定的文稿版本。企业副本由目标空间权限管理，之后的个人修改不会自动同步。</p>
      {receipt && history.value?.items.some((p) => p.id === receipt.id) && (
        <p role="status" className="access-success">
          已发布到企业资料 v{receipt.materialVersion}：{receipt.filename}。
          <a href={libraryHref(tenant, receipt.workspaceId, receipt.folderId || undefined)}>查看目标文件夹</a>
        </p>
      )}
      {history.error ? (
        <Failure error={history.error} retry={() => setAttempt((n) => n + 1)} />
      ) : (
        history.value &&
        (history.value.items.length > 0 || page > 0) && (
          <>
            <h3>发布记录</h3>
            <ul className="publication-history">
              {history.value.items.map((p) => (
                <li key={p.id}>
                  <strong>{p.filename}</strong>
                  <span>
                    文稿 v{p.documentVersion} → 企业资料 v{p.materialVersion}
                  </span>
                  <time>{new Date(p.publishedAt).toLocaleString()}</time>
                  <a href={libraryHref(tenant, p.workspaceId, p.folderId || undefined)}>查看目标文件夹</a>
                </li>
              ))}
            </ul>
            <Pager page={page} next={history.value.hasMore} onPage={setPage} />
          </>
        )
      )}
      {open && (
        <PublishDialog
          tenant={tenant}
          id={id}
          version={version}
          onClose={() => setOpen(false)}
          complete={(value) => {
            setReceipt(value);
            setOpen(false);
            setPage(0);
            setAttempt((n) => n + 1);
          }}
        />
      )}
    </section>
  );
}
function PublishDialog({
  tenant,
  id,
  version,
  onClose,
  complete,
}: {
  tenant: string;
  id: string;
  version: DocumentVersion;
  onClose: () => void;
  complete: (v: DocumentPublication) => void;
}) {
  const [attempt, setAttempt] = useState(0),
    [workspace, setWorkspace] = useState(''),
    [folder, setFolder] = useState<string | null>(null),
    [mode, setMode] = useState('new'),
    [format, setFormat] = useState<'docx' | 'pdf'>('docx'),
    [target, setTarget] = useState<MaterialEntry>(),
    [page, setPage] = useState(0),
    [confirmed, setConfirmed] = useState(false);
  const context = useRemote((signal) => identityClient.context(tenant, signal), [tenant, attempt]);
  const submit = useSubmission<Omit<PublishDocument, 'requestId'>>();
  const locked = submit.busy || submit.uncertain;
  return (
    <Modal
      title="发布企业资料"
      wide
      onClose={() => {
        if (!submit.busy) onClose();
      }}
    >
      <p>
        本次发布：
        <strong>
          {version.title} · 文稿 v{version.number}
        </strong>
      </p>
      {context.error ? (
        <Failure error={context.error} retry={() => setAttempt((n) => n + 1)} />
      ) : !context.value ? (
        <Loading />
      ) : (
        <>
          <fieldset className="publication-fields" disabled={locked}>
            <Field label="目标空间">
              <select
                aria-label="目标空间"
                value={workspace}
                onChange={(e) => {
                  setWorkspace(e.target.value);
                  setFolder(null);
                  setTarget(undefined);
                  setPage(0);
                  setConfirmed(false);
                }}
              >
                <option value="">请选择共享空间</option>
                {context.value.workspaces
                  .filter((w) => w.kind === 'SHARED')
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="发布方式">
              <select
                aria-label="发布方式"
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value);
                  setTarget(undefined);
                  setConfirmed(false);
                }}
              >
                <option value="new">新建企业资料</option>
                <option value="update">更新已有企业资料</option>
              </select>
            </Field>
            <Field label="发布格式">
              <select
                aria-label="发布格式"
                value={format}
                onChange={(e) => {
                  setFormat(e.target.value as 'docx' | 'pdf');
                  setConfirmed(false);
                }}
              >
                <option value="docx">Word</option>
                <option value="pdf">PDF</option>
              </select>
            </Field>
          </fieldset>
          {workspace && (
            <Destination
              key={workspace + ':' + folder + ':' + page + ':' + mode}
              tenant={tenant}
              workspace={workspace}
              folder={folder}
              mode={mode}
              format={format}
              target={target}
              page={page}
              locked={locked}
              busy={submit.busy}
              uncertain={submit.uncertain}
              confirmed={confirmed}
              setConfirmed={setConfirmed}
              onFolder={(v) => {
                setFolder(v);
                setPage(0);
                setTarget(undefined);
                setConfirmed(false);
              }}
              onPage={setPage}
              onTarget={(v) => {
                setTarget(v);
                setConfirmed(false);
              }}
              publish={() =>
                void submit.submit(
                  {
                    workspaceId: workspace,
                    ...(mode === 'new'
                      ? { folderId: folder }
                      : { materialId: target!.id, expectedMaterialVersion: target!.version }),
                    format,
                    acknowledgeIndependentCopy: true,
                  },
                  async (body, requestId) => {
                    complete(await api.publish(tenant, id, version.number, { ...body, requestId }));
                  },
                )
              }
            />
          )}
        </>
      )}
      <SubmitError error={submit.error} uncertain={submit.uncertain} />
    </Modal>
  );
}
function Destination({
  tenant,
  workspace,
  folder,
  mode,
  format,
  target,
  page,
  locked,
  busy,
  uncertain,
  confirmed,
  setConfirmed,
  onFolder,
  onPage,
  onTarget,
  publish,
}: {
  tenant: string;
  workspace: string;
  folder: string | null;
  mode: string;
  format: string;
  target?: MaterialEntry;
  page: number;
  locked: boolean;
  busy: boolean;
  uncertain: boolean;
  confirmed: boolean;
  setConfirmed: (v: boolean) => void;
  onFolder: (v: string | null) => void;
  onPage: (v: number) => void;
  onTarget: (v: MaterialEntry) => void;
  publish: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const location = useRemote(
    (signal) => materialClient.list(tenant, workspace, folder, '', page * 24, signal),
    [tenant, workspace, folder, page, attempt],
  );
  if (location.error) return <Failure error={location.error} retry={() => setAttempt((n) => n + 1)} />;
  if (!location.value) return <Loading />;
  const value = location.value;
  return (
    <div className="publication-destination">
      <fieldset className="publication-fields" disabled={locked}>
        <nav aria-label="发布文件夹">
          <Button onClick={() => onFolder(null)}>空间根目录</Button>
          {value.trail.map((f) => (
            <Button key={f.id} onClick={() => onFolder(f.id)}>
              {f.name}
            </Button>
          ))}
        </nav>
        {!value.canMaintain && (
          <p role="alert" className="access-alert">
            你对这个空间只有查看权限，请选择有维护权限的空间。
          </p>
        )}
        <div className="publication-choices">
          {value.items
            .filter((e) => e.kind === 'FOLDER' || mode === 'update')
            .map((e) => (
              <Button
                key={e.id}
                icon={e.kind === 'FOLDER' ? Folder : FileText}
                aria-pressed={target?.id === e.id}
                onClick={() => (e.kind === 'FOLDER' ? onFolder(e.id) : onTarget(e))}
              >
                {e.name}
                {e.kind === 'DOCUMENT' ? ` · 当前 v${e.version}` : ''}
              </Button>
            ))}
        </div>
        <Pager page={page} next={value.hasMore} onPage={onPage} />
        <p>
          {mode === 'new'
            ? `将在当前文件夹新建 ${format === 'pdf' ? 'PDF' : 'Word'} 资料。`
            : target
              ? `将更新“${target.name}”：企业资料 v${target.version} → v${target.version + 1}，旧版本保留。`
              : '请选择要更新的企业资料。'}
        </p>
        <label className="publication-confirm">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          我已检查内容，确认目标空间成员可独立阅读此副本；原资料和私人会话不随之公开。
        </label>
      </fieldset>
      <Button
        variant="primary"
        disabled={!confirmed || !value.canMaintain || (mode === 'update' && !target) || locked}
        onClick={publish}
      >
        确认发布
      </Button>
      {uncertain && (
        <Button disabled={busy} onClick={publish}>
          重试本次发布
        </Button>
      )}
    </div>
  );
}

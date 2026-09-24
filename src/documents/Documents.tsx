import { readTabDraft, writeTabDraft, removeTabDraft } from '../shared/tab-drafts';
import { DraftWarning } from '../shared/DraftWarning';
import { PublicationPanel } from './Publication';
import { useEffect, useRef, useState } from 'react';
import { FileText, RefreshCw, Save, Download } from 'lucide-react';
import type { DocumentDetail, SaveDocument } from '../../contracts/public-api/document';
import { useSession } from '../identity/session';
import { IdentityError, record, uuid } from '../identity/client';
import { Button, Field, PageActions, Badge, Empty } from '../shared/ui';
import { Failure, Loading, Pager, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { documentClient as api } from './client';
import { libraryHref } from '../material/Library';
import './documents.css';
import { documentsHref } from './routes';
export function SaveAsDocument({
  tenant,
  conversation,
  task,
  artifact,
  label = '保存为个人文稿',
}: {
  tenant: string;
  conversation: string;
  task: string;
  artifact?: string;
  label?: string;
}) {
  const submit = useSubmission<object>();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return (
    <span className="save-document">
      <Button
        icon={FileText}
        disabled={submit.busy}
        onClick={() =>
          void submit.submit({}, async (_, requestId) => {
            const origin = location.hash;
            const value = await api.create(tenant, {
              requestId,
              conversationId: conversation,
              taskId: task,
              ...(artifact ? { artifactId: artifact } : {}),
            });
            if (mounted.current && location.hash === origin)
              location.hash = documentsHref(tenant, value.document.id);
          })
        }
      >
        {label}
      </Button>
      <SubmitError error={submit.error} uncertain={submit.uncertain} />
    </span>
  );
}
export function Documents({ tenant }: { tenant: string }) {
  const [hash, setHash] = useState(location.hash),
    [attempt, setAttempt] = useState(0),
    [page, setPage] = useState(0);
  const { session } = useSession();
  const refresh = () => setAttempt((n) => n + 1);
  useEffect(() => {
    const change = () => setHash(location.hash);
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  const params = new URLSearchParams(hash.slice(1)),
    selected = params.get('document') || undefined,
    rawVersion = params.get('version'),
    version = rawVersion ? Number(rawVersion) : undefined;
  useEffect(() => {
    const check = () => {
      if (document.visibilityState === 'visible') setAttempt((n) => n + 1);
    };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    const timer = setInterval(check, 15000);
    return () => {
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
      clearInterval(timer);
    };
  }, []);
  return (
    <section className="private-documents">
      <PageActions>
        <Button variant="ghost" icon={RefreshCw} onClick={refresh}>
          刷新
        </Button>
      </PageActions>
      <div className="document-breadcrumb">
        <a href={libraryHref(tenant)}>资料库</a>
        <span> / </span>
        <a href={documentsHref(tenant)}>个人文稿</a>
      </div>
      <p className="muted">仅自己可见。来源空间撤权后，文稿仍保留，但不能查看、编辑或导出。</p>
      {selected ? (
        <DocumentReader
          key={selected + ':' + (version || 'latest')}
          tenant={tenant}
          id={selected}
          version={version}
          invalid={!!rawVersion && (!Number.isSafeInteger(version) || Number(version) < 1)}
          attempt={attempt}
          refresh={refresh}
        />
      ) : (
        <DocumentList
          tenant={tenant}
          page={page}
          setPage={setPage}
          attempt={attempt}
          identity={session.identity}
          refresh={refresh}
        />
      )}
    </section>
  );
}
function DocumentList({
  tenant,
  page,
  setPage,
  attempt,
  identity,
  refresh,
}: {
  tenant: string;
  page: number;
  setPage: (n: number) => void;
  attempt: number;
  identity: unknown;
  refresh: () => void;
}) {
  const data = useRemote((signal) => api.list(tenant, page * 20, signal), [tenant, page, attempt, identity]);
  if (data.error) return <Failure error={data.error} retry={refresh} />;
  if (!data.value) return <Loading />;
  return (
    <>
      {!data.value.items.length ? (
        <Empty
          icon={FileText}
          title="还没有可访问的个人文稿"
          text="在完成的会话回复或 TXT/Markdown 成果旁选择保存，之后可在这里编辑和导出。"
        />
      ) : (
        <div className="document-list">
          {data.value.items.map((doc) => (
            <a key={doc.id} href={documentsHref(tenant, doc.id)}>
              <FileText />
              <strong>{doc.title}</strong>
              <span>v{doc.revision}</span>
              <time>{new Date(doc.updatedAt).toLocaleString()}</time>
            </a>
          ))}
        </div>
      )}
      <Pager page={page} next={data.value.hasMore} onPage={setPage} />
    </>
  );
}
function DocumentReader({
  tenant,
  id,
  version,
  invalid,
  attempt,
  refresh,
}: {
  tenant: string;
  id: string;
  version?: number;
  invalid: boolean;
  attempt: number;
  refresh: () => void;
}) {
  const { session, expire } = useSession();
  const [data, setData] = useState<{ value?: DocumentDetail; error?: unknown }>({});
  const storageKey = `dreamcore:document:${session.identity?.account.id}:${tenant}:${id}`;
  useEffect(() => {
    const controller = new AbortController();
    if (invalid || !uuid(id)) {
      setData({ error: new IdentityError('DOCUMENT_NOT_FOUND', 404) });
      return;
    }
    api
      .detail(tenant, id, version, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setData({ value });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (error instanceof IdentityError && [401, 403, 404].includes(error.status)) {
          try {
            sessionStorage.removeItem(storageKey);
          } catch {}
        }
        setData({ error });
        if (error instanceof IdentityError && error.status === 401) expire();
      });
    return () => controller.abort();
  }, [tenant, id, version, invalid, attempt, session.identity, storageKey, expire]);
  if (data.error) return <Failure error={data.error} retry={refresh} />;
  if (!data.value) return <Loading />;
  return (
    <Editor
      key={data.value.version.number + ':' + (version ? 'historical' : 'current')}
      tenant={tenant}
      value={data.value}
      historical={!!version}
      storageKey={storageKey}
      refresh={refresh}
      denied={(error) => {
        try {
          sessionStorage.removeItem(storageKey);
        } catch {}
        setData({ error });
      }}
    />
  );
}
function Editor({
  tenant,
  value,
  historical,
  storageKey,
  refresh,
  denied,
}: {
  tenant: string;
  value: DocumentDetail;
  historical: boolean;
  storageKey: string;
  refresh: () => void;
  denied: (e: unknown) => void;
}) {
  const [loaded] = useState(() => (historical ? { unreadable: false } : readTabDraft(storageKey)));
  const [stored, setStored] = useState(!loaded.unreadable);
  const restored = useRef(
    (() => {
      if (historical) return undefined;
      try {
        const v = loaded.value;
        if (record(v) && !v.pending && v.title === value.version.title && v.body === value.version.body)
          return undefined;
        return record(v) &&
          typeof v.title === 'string' &&
          v.title.length <= 160 &&
          typeof v.body === 'string' &&
          v.body.length <= 32768 &&
          Number.isSafeInteger(v.expectedRevision) &&
          Number(v.expectedRevision) > 0
          ? v
          : undefined;
      } catch {
        return undefined;
      }
    })(),
  );
  const [title, setTitle] = useState(String(restored.current?.title ?? value.version.title)),
    [body, setBody] = useState(String(restored.current?.body ?? value.version.body)),
    [base, setBase] = useState(Number(restored.current?.expectedRevision ?? value.version.number));
  const [pending, setPending] = useState<SaveDocument | undefined>(() => {
    const p = restored.current?.pending;
    return record(p) &&
      uuid(p.requestId) &&
      typeof p.title === 'string' &&
      typeof p.body === 'string' &&
      Number.isSafeInteger(p.expectedRevision)
      ? (p as unknown as SaveDocument)
      : undefined;
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [notice, setNotice] = useState(restored.current ? '已恢复未保存草稿。' : '');
  const download = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const dirty = title !== value.version.title || body !== value.version.body;
  useEffect(() => () => download.current?.abort(), []);
  useEffect(() => {
    if (historical) return;
    setStored(
      dirty || pending
        ? writeTabDraft(storageKey, { title, body, expectedRevision: base, pending })
        : removeTabDraft(storageKey),
    );
  }, [title, body, base, pending, dirty, historical, storageKey]);
  const onError = (e: unknown) => {
    if (e instanceof IdentityError && [401, 403, 404].includes(e.status)) denied(e);
    else setError(e);
  };
  return (
    <div className="document-editor">
      <div className="document-version-bar">
        <Badge>
          {historical ? '历史版本' : '个人文稿'} v{value.version.number}
        </Badge>
        <span>最新 v{value.document.revision}</span>
        <Button
          disabled={value.version.number <= 1 || busy}
          onClick={() => {
            location.hash = documentsHref(tenant, value.document.id, value.version.number - 1);
          }}
        >
          上一版本
        </Button>
        {historical && (
          <Button
            onClick={() => {
              location.hash = documentsHref(tenant, value.document.id);
            }}
          >
            返回最新版本
          </Button>
        )}
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || historical) return;
          const payload = pending || { requestId: crypto.randomUUID(), expectedRevision: base, title, body };
          setPending(payload);
          setBusy(true);
          setError(undefined);
          setStored(writeTabDraft(storageKey, { title, body, expectedRevision: base, pending: payload }));
          try {
            const saved = await api.save(tenant, value.document.id, payload);
            if (!mounted.current) return;
            setPending(undefined);
            setBase(saved.version.number);
            setTitle(saved.version.title);
            setBody(saved.version.body);
            setNotice('已保存 v' + saved.version.number);
            setStored(removeTabDraft(storageKey));
            refresh();
          } catch (error) {
            if (!mounted.current) return;
            onError(error);
            if (error instanceof IdentityError && error.status >= 400 && error.status < 500)
              setPending(undefined);
          } finally {
            if (mounted.current) setBusy(false);
          }
        }}
      >
        <fieldset disabled={historical || busy || !!pending}>
          <Field label="文稿标题">
            <input
              aria-label="文稿标题"
              value={title}
              maxLength={160}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field
            label="文稿正文"
            hint="支持纯文字及 # 标题。其他 Markdown 标记按文字保留；导出不读取外部图片或链接。"
          >
            <textarea
              aria-label="文稿正文"
              value={body}
              maxLength={32768}
              onChange={(e) => setBody(e.target.value)}
              spellCheck={false}
            />
          </Field>
        </fieldset>
        {base !== value.document.revision && !historical && (
          <p role="alert" className="access-alert">
            服务器已有新版本。当前草稿基于 v{base}，保存时会检查冲突；请保留需要的内容后载入最新。
          </p>
        )}
        <div className="document-actions">
          {!historical && (
            <>
              <Button type="submit" variant="primary" icon={Save} disabled={busy || (!dirty && !pending)}>
                {pending ? '重试本次保存' : '保存新版本'}
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  setStored(removeTabDraft(storageKey));
                  setPending(undefined);
                  setTitle(value.version.title);
                  setBody(value.version.body);
                  setBase(value.document.revision);
                  setError(undefined);
                  setNotice('已载入保存的版本');
                  refresh();
                }}
              >
                放弃草稿，载入最新
              </Button>
            </>
          )}
          {(['docx', 'pdf'] as const).map((format) => (
            <Button
              key={format}
              icon={Download}
              disabled={busy || dirty || !!pending}
              onClick={async () => {
                setBusy(true);
                setError(undefined);
                const controller = new AbortController();
                download.current = controller;
                try {
                  const blob = await api.download(
                    tenant,
                    value.document.id,
                    value.version.number,
                    format,
                    controller.signal,
                  );
                  if (controller.signal.aborted) return;
                  const url = URL.createObjectURL(blob),
                    link = document.createElement('a');
                  link.href = url;
                  link.download = `${value.version.title.replace(/[\\/:*?"<>|]/g, '_')}-v${value.version.number}.${format}`;
                  link.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                } catch (error) {
                  if (!controller.signal.aborted) onError(error);
                } finally {
                  if (!controller.signal.aborted) setBusy(false);
                }
              }}
            >
              导出 {format === 'docx' ? 'Word' : 'PDF'}
            </Button>
          ))}
        </div>
        {dirty && <p className="muted">有未保存的修改，保存后再导出。</p>}
        {!historical && (
          <DraftWarning unavailable={!stored} unreadable={loaded.unreadable} pending={!!pending} />
        )}
        <SubmitError error={error} uncertain={!!pending} />
        {notice && (
          <p role="status" className="muted">
            {notice}
          </p>
        )}
      </form>
      <PublicationPanel
        tenant={tenant}
        id={value.document.id}
        version={value.version}
        disabled={dirty || busy || !!pending}
      />
      <a
        href={
          '#' +
          new URLSearchParams({
            tenant,
            view: 'conversations',
            conversation: value.document.conversationId,
            task: value.document.taskId,
          })
        }
      >
        查看原始任务与来源
      </a>
    </div>
  );
}

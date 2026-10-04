import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Download, Info, MoreHorizontal, Pencil, Share2, ArrowUpRight } from 'lucide-react';
import type { DocumentDetail, SaveDocument } from '../../contracts/public-api/document';
import { LiveConversationDeck } from '../conversation/LiveConversationDeck';
import { useSession } from '../identity/session';
import { IdentityError, record, uuid } from '../identity/client';
import { Button, DocumentText, IconButton, Modal } from '../shared/ui';
import { ActionPopover } from '../shared/ActionPopover';
import { DraftWarning } from '../shared/DraftWarning';
import { Failure, Loading, SubmitError } from '../shared/admin';
import { readTabDraft, removeTabDraft, writeTabDraft } from '../shared/tab-drafts';
import { requestNavigationLocked, useRequestLock } from '../shared/request-guard';
import { documentClient as api } from './client';
import { PublicationPanel, PublishDialog } from './Publication';
import './documents.css';

type Draft = { title: string; body: string; expectedRevision: number; pending?: SaveDocument };
type DeferredAction = { run: () => void; requiresSave?: boolean };
const draftFrom = (value: DocumentDetail): Draft => ({
  title: value.version.title,
  body: value.version.body,
  expectedRevision: value.version.number,
});
function restoredDraft(value: unknown): Draft | undefined {
  if (
    !record(value) ||
    typeof value.title !== 'string' ||
    value.title.length > 160 ||
    typeof value.body !== 'string' ||
    value.body.length > 32768 ||
    !Number.isSafeInteger(value.expectedRevision) ||
    Number(value.expectedRevision) < 1
  )
    return;
  const pending = value.pending;
  if (
    pending !== undefined &&
    (!record(pending) ||
      !uuid(pending.requestId) ||
      pending.title !== value.title ||
      pending.body !== value.body ||
      pending.expectedRevision !== value.expectedRevision)
  )
    return;
  return value as Draft;
}

export function DocumentCard(props: {
  tenant: string;
  id: string;
  close: () => void;
  initialVersion?: number;
  invalid?: boolean;
  readAttempt?: number;
}) {
  const { session } = useSession();
  return <DocumentSurface key={`${session.identity?.account.id}:${props.tenant}:${props.id}`} {...props} />;
}

function DocumentSurface({
  tenant,
  id,
  close,
  initialVersion,
  invalid = false,
  readAttempt = 0,
}: {
  tenant: string;
  id: string;
  close: () => void;
  initialVersion?: number;
  invalid?: boolean;
  readAttempt?: number;
}) {
  const { session, expire } = useSession();
  const storageKey = `dreamcore:document:${session.identity?.account.id}:${tenant}:${id}`;
  const [loaded] = useState(() => readTabDraft(storageKey));
  const [draft, setDraft] = useState<Draft>({ title: '', body: '', expectedRevision: 1 });
  const [value, setValue] = useState<DocumentDetail>();
  const [readError, setReadError] = useState<unknown>();
  const [error, setError] = useState<unknown>();
  const [version, setVersion] = useState(initialVersion);
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<'save' | 'export'>();
  const [stored, setStored] = useState(!loaded.unreadable);
  const [properties, setProperties] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [publish, setPublish] = useState(false);
  const [publicationRevision, setPublicationRevision] = useState(0);
  const [confirm, setConfirm] = useState<DeferredAction>();
  const [compare, setCompare] = useState(false);
  const initialized = useRef(false);
  const mounted = useRef(true);
  const moreAnchor = useRef<HTMLDivElement>(null);
  const bodyInput = useRef<HTMLTextAreaElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const download = useRef<AbortController | null>(null);
  const scrollPosition = useRef(0);
  const state = useRef({ editing, busy, pending: draft.pending });
  state.current = { editing, busy, pending: draft.pending };
  const historical = version !== undefined;
  const dirty =
    !!value && !historical && (draft.title !== value.version.title || draft.body !== value.version.body);
  useRequestLock(busy === 'save' || !!draft.pending);
  const refresh = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      download.current?.abort();
    };
  }, []);
  const deny = useCallback(
    (failure: unknown) => {
      if (failure instanceof IdentityError && [401, 403, 404].includes(failure.status)) {
        removeTabDraft(storageKey);
        setValue(undefined);
        setDraft({ title: '', body: '', expectedRevision: 1 });
        setEditing(false);
        setReadError(failure);
        if (failure.status === 401) expire();
        return true;
      }
      return false;
    },
    [storageKey, expire],
  );
  useEffect(() => {
    let controller: AbortController | undefined;
    const read = () => {
      if (state.current.busy || state.current.pending) return;
      controller?.abort();
      controller = new AbortController();
      const current = controller;
      void (
        invalid || !uuid(id)
          ? Promise.reject(new IdentityError('DOCUMENT_NOT_FOUND', 404))
          : api.detail(tenant, id, version, current.signal)
      )
        .then((detail) => {
          if (current.signal.aborted || state.current.busy || state.current.pending) return;
          setValue(detail);
          setReadError(undefined);
          if (!initialized.current) {
            const restored = version === undefined ? restoredDraft(loaded.value) : undefined;
            const changed =
              restored &&
              (restored.pending ||
                restored.title !== detail.version.title ||
                restored.body !== detail.version.body);
            setDraft(changed ? restored : draftFrom(detail));
            setEditing(!!changed);
            initialized.current = true;
          } else if (!state.current.editing) setDraft(draftFrom(detail));
        })
        .catch((failure) => {
          if (!current.signal.aborted && !deny(failure)) setReadError(failure);
        });
    };
    const focus = () => {
      if (document.visibilityState === 'visible') read();
    };
    read();
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    return () => {
      controller?.abort();
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', focus);
    };
  }, [tenant, id, version, invalid, attempt, readAttempt, loaded.value, deny]);
  useEffect(() => {
    if (!value || historical) return;
    setStored(dirty || draft.pending ? writeTabDraft(storageKey, draft) : removeTabDraft(storageKey));
  }, [draft, dirty, value, historical, storageKey]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    if (editing) bodyInput.current?.focus({ preventScroll: true });
    const reader = root.current?.querySelector<HTMLElement>('.live-source-reader');
    if (reader) reader.scrollTop = scrollPosition.current;
  }, [editing]);
  useLayoutEffect(() => {
    const input = bodyInput.current;
    const reader = input?.parentElement;
    if (!editing || !input || !reader) return;
    const resize = () => {
      const top = reader.scrollTop;
      input.style.height = '0px';
      const style = getComputedStyle(reader);
      const notices = reader.querySelector('.document-inline-notices')?.getBoundingClientRect().height || 0;
      input.style.height = `${Math.max(input.scrollHeight, reader.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - notices)}px`;
      reader.scrollTop = top;
    };
    resize();
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(resize);
    });
    observer.observe(reader);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [editing, draft.body]);
  const rememberScroll = () => {
    scrollPosition.current = root.current?.querySelector<HTMLElement>('.live-source-reader')?.scrollTop || 0;
  };
  const request = (action: DeferredAction) => {
    if (busy || draft.pending || requestNavigationLocked()) return;
    setMoreOpen(false);
    if (dirty) setConfirm(action);
    else action.run();
  };
  const discard = () => {
    if (value) setDraft(draftFrom(value));
    setStored(removeTabDraft(storageKey));
    setError(undefined);
    rememberScroll();
    setEditing(false);
  };
  const save = async (after?: () => void) => {
    if (
      !value ||
      historical ||
      busy ||
      (!dirty && !draft.pending) ||
      !draft.title.trim() ||
      !draft.body.trim()
    )
      return;
    const payload = draft.pending || {
      requestId: crypto.randomUUID(),
      expectedRevision: draft.expectedRevision,
      title: draft.title,
      body: draft.body,
    };
    const snapshot = { ...draft, pending: payload };
    setDraft(snapshot);
    setStored(writeTabDraft(storageKey, snapshot));
    setBusy('save');
    setError(undefined);
    try {
      const saved = await api.save(tenant, id, payload);
      if (!mounted.current) return;
      setValue(saved);
      setDraft(draftFrom(saved));
      setStored(removeTabDraft(storageKey));
      rememberScroll();
      setEditing(false);
      setConfirm(undefined);
      // Actions after saving must use the returned version, never the previous render's version.
      after?.();
    } catch (failure) {
      if (!mounted.current || deny(failure)) return;
      setError(failure);
      if (failure instanceof IdentityError && failure.status >= 400 && failure.status < 500) {
        setDraft((previous) => ({ ...previous, pending: undefined }));
        if (failure.code === 'DOCUMENT_REVISION_CONFLICT') refresh();
      }
      setConfirm(undefined);
    } finally {
      if (mounted.current) setBusy(undefined);
    }
  };
  const exportDocument = async (format: 'docx' | 'pdf') => {
    if (!value) return;
    setMoreOpen(false);
    setBusy('export');
    setError(undefined);
    const controller = new AbortController();
    download.current = controller;
    try {
      const blob = await api.download(tenant, id, value.version.number, format, controller.signal);
      if (controller.signal.aborted || !mounted.current) return;
      const url = URL.createObjectURL(blob),
        link = document.createElement('a');
      link.href = url;
      link.download = `${value.version.title.replace(/[\\/:*?"<>|]/g, '_')}-v${value.version.number}.${format}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {
      if (!controller.signal.aborted && !deny(failure)) setError(failure);
    } finally {
      if (mounted.current) setBusy(undefined);
    }
  };
  const versionChange = (next?: number) =>
    request({
      run: () => {
        setValue(undefined);
        setError(undefined);
        setEditing(false);
        setVersion(next);
      },
    });
  // Defer export/publication until a subsequent render, so saving cannot export an obsolete version.
  const [savedAction, setSavedAction] = useState<'docx' | 'pdf' | 'publish'>();
  useEffect(() => {
    if (!savedAction || editing || busy || draft.pending || dirty || !value) return;
    const action = savedAction;
    setSavedAction(undefined);
    if (action === 'publish') setPublish(true);
    else void exportDocument(action);
  }, [savedAction, editing, busy, draft.pending, dirty, value]);
  const output = (action: 'docx' | 'pdf' | 'publish') =>
    request({ requiresSave: true, run: () => setSavedAction(action) });
  const propertyContent = value && (
    <>
      <dl className="document-card-metadata">
        <dt>位置</dt>
        <dd>{session.identity?.account.displayName || '我的'} · 个人空间</dd>
        <dt>可见范围</dt>
        <dd>仅本人</dd>
        <dt>当前版本</dt>
        <dd>
          v{value.version.number}
          {historical ? ' · 历史版本' : ''}
        </dd>
        <dt>最新版本</dt>
        <dd>v{value.document.revision}</dd>
        <dt>保存时间</dt>
        <dd>{new Date(value.version.createdAt).toLocaleString()}</dd>
      </dl>
      <div className="document-card-versions" aria-label="版本记录">
        <h3>版本记录</h3>
        <Button
          disabled={!!busy || !!draft.pending || value.version.number <= 1}
          onClick={() => versionChange(value.version.number - 1)}
        >
          上一版本
        </Button>
        {historical && (
          <Button disabled={!!busy || !!draft.pending} onClick={() => versionChange()}>
            查看最新版本
          </Button>
        )}
      </div>
      <PublicationPanel
        key={publicationRevision}
        historyOnly
        tenant={tenant}
        id={id}
        version={value.version}
        disabled={dirty || !!busy || !!draft.pending}
      />
    </>
  );
  const closeCard = () => request({ run: close });
  return (
    <>
      <Modal
        title="个人资料"
        wide
        className="live-library-deck-modal document-card-modal"
        onClose={closeCard}
      >
        <div ref={root} className={`document-card-surface ${editing ? 'is-editing' : ''}`}>
          <LiveConversationDeck
            tenant={tenant}
            reader
            persistenceKey={`document:${id}`}
            title={value?.version.title || '个人资料'}
            titleContent={
              editing && (
                <input
                  className="document-inline-title"
                  aria-label="文稿标题"
                  value={draft.title}
                  maxLength={160}
                  disabled={!!busy || !!draft.pending}
                  onChange={(event) => setDraft((previous) => ({ ...previous, title: event.target.value }))}
                />
              )
            }
            onClose={close}
            beforeClose={() => {
              if (dirty) {
                closeCard();
                return false;
              }
              return true;
            }}
            mainActions={
              <>
                {value &&
                  !readError &&
                  (editing ? (
                    <>
                      <Button disabled={!!busy || !!draft.pending} onClick={() => request({ run: discard })}>
                        取消
                      </Button>
                      <Button
                        variant="primary"
                        disabled={
                          !!busy || (!dirty && !draft.pending) || !draft.title.trim() || !draft.body.trim()
                        }
                        onClick={() => void save()}
                      >
                        {busy === 'save' ? '保存中' : draft.pending ? '重试保存' : '保存'}
                      </Button>
                    </>
                  ) : (
                    !historical && (
                      <Button
                        icon={Pencil}
                        disabled={!!busy}
                        onClick={() => {
                          rememberScroll();
                          setEditing(true);
                          setError(undefined);
                        }}
                      >
                        编辑
                      </Button>
                    )
                  ))}
                {value && !readError && (
                  <div className="workspace-more-actions" ref={moreAnchor}>
                    <IconButton
                      icon={MoreHorizontal}
                      label="更多资料操作"
                      aria-expanded={moreOpen}
                      disabled={!!busy || !!draft.pending}
                      onClick={() => setMoreOpen(!moreOpen)}
                    />
                    {moreOpen && (
                      <ActionPopover
                        anchor={moreAnchor}
                        label="更多资料操作"
                        onClose={() => setMoreOpen(false)}
                      >
                        <Button icon={Download} onClick={() => output('docx')}>
                          导出 Word
                        </Button>
                        <Button icon={Download} onClick={() => output('pdf')}>
                          导出 PDF
                        </Button>
                        <Button icon={Share2} onClick={() => output('publish')}>
                          发布到企业资料库
                        </Button>
                        <Button
                          icon={ArrowUpRight}
                          onClick={() =>
                            request({
                              run: () => {
                                close();
                                location.hash =
                                  '#' +
                                  new URLSearchParams({
                                    tenant,
                                    view: 'conversations',
                                    conversation: value.document.conversationId,
                                    task: value.document.taskId,
                                  });
                              },
                            })
                          }
                        >
                          查看原始会话
                        </Button>
                      </ActionPopover>
                    )}
                  </div>
                )}
                <IconButton
                  icon={Info}
                  label="资料属性"
                  aria-pressed={properties}
                  disabled={!value || !!readError}
                  onClick={() => setProperties(!properties)}
                />
              </>
            }
            cards={
              properties && value && !readError
                ? [
                    {
                      id: 'properties',
                      parentId: 'conversation',
                      kind: 'properties',
                      title: '资料属性',
                      label: '资料属性',
                      content: propertyContent,
                      close: () => setProperties(false),
                    },
                  ]
                : []
            }
          >
            {readError && !value ? (
              <Failure error={readError} retry={refresh} />
            ) : !value ? (
              <Loading />
            ) : (
              <>
                <div className="document-inline-notices">
                  {!!readError && <Failure error={readError} retry={refresh} />}
                  <SubmitError error={error} uncertain={!!draft.pending} />
                  {draft.pending && !error && !busy && (
                    <p role="alert" className="access-alert">
                      上次保存结果尚未确认，请重试保存以核对同一次请求。
                    </p>
                  )}
                  {editing && draft.expectedRevision !== value.document.revision && (
                    <div role="alert" className="access-alert">
                      服务器已有 v{value.document.revision}，当前草稿基于 v{draft.expectedRevision}
                      。修改已保留，请核对最新内容后再保存。
                      <Button onClick={() => setCompare(true)}>核对最新内容</Button>
                      <Button
                        disabled={!!busy || !!draft.pending}
                        onClick={() =>
                          request({
                            run: () => {
                              setEditing(false);
                              setValue(undefined);
                              setVersion(undefined);
                              refresh();
                            },
                          })
                        }
                      >
                        载入最新版本
                      </Button>
                    </div>
                  )}
                  {editing && (
                    <DraftWarning
                      unavailable={!stored}
                      unreadable={loaded.unreadable}
                      pending={!!draft.pending}
                    />
                  )}
                </div>
                {editing ? (
                  <textarea
                    ref={bodyInput}
                    className="document-inline-body"
                    aria-label="文稿正文"
                    value={draft.body}
                    maxLength={32768}
                    spellCheck={false}
                    disabled={!!busy || !!draft.pending}
                    onChange={(event) => setDraft((previous) => ({ ...previous, body: event.target.value }))}
                  />
                ) : (
                  <DocumentText text={value.version.body} />
                )}
              </>
            )}
          </LiveConversationDeck>
        </div>
      </Modal>
      {confirm && (
        <Modal
          title={confirm.requiresSave ? '保存修改后继续' : '有未保存的修改'}
          onClose={() => setConfirm(undefined)}
          className="document-exit-confirm"
        >
          <p>{confirm.requiresSave ? '此操作使用保存后的版本。' : '是否保存当前修改？'}</p>
          <div className="document-confirm-actions">
            <Button onClick={() => setConfirm(undefined)}>继续编辑</Button>
            {!confirm.requiresSave && (
              <Button
                onClick={() => {
                  const action = confirm;
                  discard();
                  setConfirm(undefined);
                  action.run();
                }}
              >
                放弃修改
              </Button>
            )}
            <Button
              variant="primary"
              disabled={!draft.title.trim() || !draft.body.trim() || !!busy}
              onClick={() => void save(confirm.run)}
            >
              {busy === 'save' ? '保存中' : '保存并继续'}
            </Button>
          </div>
        </Modal>
      )}
      {publish && value && (
        <PublishDialog
          tenant={tenant}
          id={id}
          version={value.version}
          onClose={() => {
            if (!requestNavigationLocked()) setPublish(false);
          }}
          complete={() => {
            setPublish(false);
            setPublicationRevision((n) => n + 1);
          }}
        />
      )}
      {compare && value && (
        <Modal title={`最新版本 v${value.version.number}`} onClose={() => setCompare(false)} wide>
          <h3>{value.version.title}</h3>
          <DocumentText text={value.version.body} />
          <div className="document-confirm-actions">
            <Button onClick={() => setCompare(false)}>返回编辑</Button>
          </div>
        </Modal>
      )}
    </>
  );
}

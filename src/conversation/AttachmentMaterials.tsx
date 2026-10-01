import type { MaterialDetail } from '../../contracts/public-api/material';
import { useSession } from '../identity/session';
import { materialClient } from '../material/client';
import { readTabDraft, writeTabDraft } from '../shared/tab-drafts';
import { conversationHref } from './Conversations';
import { isOriginal } from './client';
import { useEffect, useRef, useState } from 'react';
import { Paperclip, Files, Info, Upload, X } from 'lucide-react';
import type { TaskOriginal } from '../../contracts/public-api/conversation';
import type { TenantContext } from '../../contracts/public-api/identity';
import type { Conversation } from '../../contracts/public-api/conversation';
import { createIdentityRequest, record, uuid } from '../identity/client';
import { isUploadReceipt, isDetail, type MaterialUploadReceipt } from '../material/client';
import { knowledgeClient } from '../material/knowledge-client';
import { AnalysisPanel } from '../material/Knowledge';
import { LiveConversationDeck } from './LiveConversationDeck';
import { Button, Modal, IconButton } from '../shared/ui';
import { SubmitError, useRemote, useSubmission } from '../shared/admin';
import { OriginalPicker } from './OriginalPicker';
const request = createIdentityRequest(fetch, 120000);
const root = (tenant: string) => `/api/v1/tenants/${tenant}`;
export async function uploadAttachment(
  tenant: string,
  conversation: string | undefined,
  draftRequestId: string,
  requestId: string,
  file: File,
) {
  const form = new FormData();
  form.set(
    'metadata',
    new Blob([JSON.stringify({ conversationId: conversation, draftRequestId, requestId })], {
      type: 'application/json',
    }),
  );
  form.set('file', file, file.name);
  return request(
    root(tenant) + '/conversation-attachments',
    'POST',
    (v): v is { conversation: Conversation; file: MaterialUploadReceipt } =>
      record(v) &&
      record(v.conversation) &&
      uuid(v.conversation.id) &&
      v.conversation.tenantId === tenant &&
      isUploadReceipt(v.file) &&
      v.file.tenantId === tenant,
    form,
  );
}
export function AttachmentReader({
  tenant,
  file,
  conversation,
  close,
}: {
  tenant: string;
  file: TaskOriginal;
  conversation?: string;
  close: () => void;
}) {
  const [properties, setProperties] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const save = useSubmission<Record<string, never>>();
  const [savedHere, setSaved] = useState(false);
  const stored = useRemote(
    (signal) =>
      conversation && file.workspaceId
        ? materialClient.detail(tenant, file.workspaceId, file.materialId, 0, signal)
        : Promise.resolve(null),
    [tenant, file.materialId, conversation, refresh],
  );
  const saved = savedHere || stored.value?.inLibrary === true;
  if (!file.workspaceId) return null;
  return (
    <Modal title={file.filename} wide className="live-library-deck-modal" onClose={close}>
      <LiveConversationDeck
        tenant={tenant}
        reader
        onRefresh={() => setRefresh((n) => n + 1)}
        title={file.filename}
        onClose={close}
        mainActions={<IconButton icon={Info} label="查看文件属性" onClick={() => setProperties(true)} />}
        cards={
          properties
            ? [
                {
                  id: 'properties',
                  kind: 'properties',
                  title: file.filename,
                  label: '文件属性',
                  parentId: 'conversation',
                  close: () => setProperties(false),
                  content: (
                    <>
                      <dl className="live-material-properties">
                        <dt>固定版本</dt>
                        <dd>v{file.version}</dd>
                        <dt>大小</dt>
                        <dd>{file.bytes.toLocaleString()} 字节</dd>
                        <dt>保存位置</dt>
                        <dd>
                          {conversation
                            ? saved
                              ? '个人资料库，同时保留在本会话'
                              : '本人的私有会话附件'
                            : '已有资料的指定版本'}
                        </dd>
                      </dl>
                      {conversation && (
                        <>
                          <Button
                            disabled={save.busy || saved}
                            onClick={() =>
                              void save.submit({}, async (_, requestId) => {
                                await request(
                                  root(tenant) +
                                    `/conversations/${conversation}/attachments/${file.materialId}/save`,
                                  'POST',
                                  isDetail,
                                  { requestId },
                                );
                                setSaved(true);
                              })
                            }
                          >
                            {saved ? '已保存到个人资料库' : '保存到个人资料库'}
                          </Button>
                          <SubmitError error={save.error} uncertain={save.uncertain} />
                        </>
                      )}
                    </>
                  ),
                },
              ]
            : []
        }
      >
        <AnalysisPanel
          tenant={tenant}
          space={file.workspaceId}
          material={file.materialId}
          version={file.versionId}
          verification={refresh}
        />
      </LiveConversationDeck>
    </Modal>
  );
}
function Preparation({
  tenant,
  file,
  onReady,
}: {
  tenant: string;
  file: TaskOriginal;
  onReady: (id: string, ready: boolean) => void;
}) {
  const [tick, setTick] = useState(0);
  const data = useRemote(
    (signal) =>
      knowledgeClient.analysis(tenant, file.workspaceId!, file.materialId, file.versionId, 0, signal),
    [tenant, file.versionId, tick],
  );
  const submit = useSubmission<{ expectedGeneration: number }>();
  const status = data.value?.status;
  const ready = status === 'READY' || status === 'PARTIAL';
  useEffect(() => onReady(file.versionId, ready), [file.versionId, ready]);
  useEffect(() => {
    if (status === 'QUEUED' || status === 'RUNNING') {
      const timer = setTimeout(() => setTick((x) => x + 1), 1800);
      return () => clearTimeout(timer);
    }
  }, [status, tick]);
  return (
    <span className="attachment-preparation">
      {data.error
        ? '状态获取失败'
        : ready
          ? status === 'PARTIAL'
            ? '部分内容已准备，请核对'
            : '已准备'
          : status === 'UNSUPPORTED'
            ? '暂不支持此格式'
            : status === 'FAILED' || status === 'CANCELLED'
              ? '准备失败'
              : '正在准备…'}
      {(data.error || status === 'FAILED' || status === 'NOT_STARTED' || status === 'CANCELLED') && (
        <Button
          variant="ghost"
          disabled={submit.busy}
          onClick={() => {
            if (data.error) setTick((x) => x + 1);
            else
              void submit.submit({ expectedGeneration: data.value!.generation }, async (body, requestId) => {
                await knowledgeClient.parse(tenant, file.workspaceId!, file.materialId, file.versionId, {
                  ...body,
                  requestId,
                });
                setTick((x) => x + 1);
              });
          }}
        >
          重试
        </Button>
      )}
      <SubmitError error={submit.error} uncertain={submit.uncertain} />
    </span>
  );
}
export function AttachmentMaterials({
  tenant,
  conversation,
  draftRequestId,
  context,
  files,
  setFiles,
  onConversation,
  onBusy,
  onReady,
  dropped,
  verification = false,
}: {
  tenant: string;
  conversation?: string;
  draftRequestId: string;
  context: TenantContext;
  files: TaskOriginal[];
  setFiles: (files: TaskOriginal[]) => void;
  onConversation: (id: string) => void;
  onBusy: (busy: boolean) => void;
  onReady: (id: string, ready: boolean) => void;
  dropped?: { files: File[]; sequence: number };
  verification?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null),
    lock = useRef(false),
    currentFiles = useRef(files),
    currentConversation = useRef(conversation);
  currentFiles.current = files;
  currentConversation.current = conversation;
  const [open, setOpen] = useState(false),
    [picking, setPicking] = useState(false),
    [reading, setReading] = useState<TaskOriginal>();
  const [uploads, setUploads] = useState<{ id: string; file: File; error?: unknown }[]>([]);
  const [error, setError] = useState<unknown>();
  const attached = useRemote(
    (signal) =>
      conversation
        ? request(
            root(tenant) + `/conversations/${conversation}/attachments`,
            'GET',
            (v): v is MaterialDetail[] => Array.isArray(v) && v.every(isDetail),
            undefined,
            signal,
          )
        : Promise.resolve([]),
    [tenant, conversation, files.length],
  );
  useEffect(() => {
    if (conversation) return;
    const controller = new AbortController();
    void request(
      root(tenant) + `/conversation-attachments/drafts/${draftRequestId}`,
      'GET',
      (v): v is { conversation: Conversation | null } =>
        record(v) &&
        (v.conversation === null ||
          (record(v.conversation) && uuid(v.conversation.id) && v.conversation.tenantId === tenant)),
      undefined,
      controller.signal,
    )
      .then((r) => {
        if (!controller.signal.aborted && r.conversation) onConversation(r.conversation.id);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [tenant, draftRequestId]);

  async function upload(entries: { id: string; file: File }[]) {
    if (lock.current) return;
    lock.current = true;
    onBusy(true);
    setError(undefined);
    try {
      for (const item of entries) {
        if (currentFiles.current.length >= 3) {
          setError(new Error('每次最多选择 3 份文件。'));
          break;
        }
        if (item.file.size > (verification ? 262144 : 20971520)) {
          setError(new Error(verification ? '验证模式单份文件上限 256 KiB' : '单份文件上限 20 MiB'));
          continue;
        }
        setUploads((list) => [...list.filter((x) => x.id !== item.id), item]);
        try {
          const receipt = await uploadAttachment(
            tenant,
            currentConversation.current,
            draftRequestId,
            item.id,
            item.file,
          );
          const v = receipt.file.acceptedVersion;
          if (!v) throw new Error('本次上传版本回执不完整，请重试核对。');
          currentConversation.current = receipt.conversation.id;
          onConversation(receipt.conversation.id);
          const next = [
            ...currentFiles.current,
            {
              materialId: receipt.file.id,
              versionId: v.id,
              filename: v.filename,
              version: v.number,
              bytes: v.sizeBytes,
              sha256: v.sha256,
              read: false,
              workspaceId: receipt.file.workspaceId,
              attachmentConversationId: receipt.conversation.id,
            },
          ];
          currentFiles.current = next;
          setFiles(next);
          setUploads((list) => list.filter((x) => x.id !== item.id));
        } catch (e) {
          setUploads((list) => list.map((x) => (x.id === item.id ? { ...x, error: e } : x)));
        }
      }
    } finally {
      lock.current = false;
      onBusy(false);
    }
  }
  useEffect(() => {
    if (dropped?.files.length) void upload(dropped.files.map((file) => ({ file, id: crypto.randomUUID() })));
  }, [dropped?.sequence]);
  return (
    <div className="attachment-materials">
      <Button icon={Paperclip} variant="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
        添加资料
      </Button>
      {open && (
        <div className="attachment-add-options">
          <Button
            icon={Upload}
            onClick={() => {
              setOpen(false);
              input.current?.click();
            }}
          >
            本地上传
          </Button>
          <Button
            icon={Files}
            onClick={() => {
              setOpen(false);
              setPicking(true);
            }}
          >
            选择已有资料
          </Button>
          <small>也可拖入文件；上传的资料先保留在此私有会话中。</small>
        </div>
      )}
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const selected = Array.from(e.target.files || []);
          e.target.value = '';
          void upload(selected.map((file) => ({ file, id: crypto.randomUUID() })));
        }}
      />
      {!!attached.value?.length && (
        <details className="conversation-kept-attachments">
          <summary>本会话保留的资料（{attached.value.length}）</summary>
          {attached.value.map((d) => {
            const v = d.versions[0];
            if (!v) return null;
            const file: TaskOriginal = {
              materialId: d.document.id,
              workspaceId: d.document.workspaceId,
              versionId: v.id,
              filename: v.filename,
              version: v.number,
              bytes: v.sizeBytes,
              sha256: v.sha256,
              read: false,
              attachmentConversationId: conversation,
            };
            return (
              <div key={file.materialId}>
                <Button variant="ghost" onClick={() => setReading(file)}>
                  {file.filename} · v{file.version}
                </Button>
                <Button
                  disabled={files.length >= 3 || files.some((f) => f.materialId === file.materialId)}
                  onClick={() => setFiles([...files, file])}
                >
                  本次引用
                </Button>
              </div>
            );
          })}
        </details>
      )}
      {files.map((file) => (
        <div className="attachment-chip" key={file.versionId}>
          <Button variant="ghost" onClick={() => setReading(file)}>
            {file.filename} · v{file.version}
          </Button>
          {file.workspaceId && <Preparation tenant={tenant} file={file} onReady={onReady} />}
          <IconButton
            icon={X}
            label={'移除 ' + file.filename}
            onClick={() => setFiles(files.filter((x) => x.versionId !== file.versionId))}
          />
        </div>
      ))}
      {uploads.map((item) => (
        <div className="attachment-chip" key={item.id}>
          <span>
            {item.file.name} · {item.error ? '上传未完成' : '上传中…'}
          </span>
          {!!item.error && (
            <>
              <Button onClick={() => void upload([item])}>重试上传</Button>
              <Button onClick={() => setUploads((list) => list.filter((x) => x.id !== item.id))}>移除</Button>
              <SubmitError error={item.error} uncertain={false} />
            </>
          )}
        </div>
      ))}
      <SubmitError error={error} uncertain={false} />
      {picking && (
        <OriginalPicker
          tenant={tenant}
          space={context.workspaces.find((s) => s.kind === 'PERSONAL')!.id}
          spaces={context.workspaces}
          verification={verification}
          selected={files}
          onSelect={(file) => setFiles([...files.filter((x) => x.materialId !== file.materialId), file])}
          onClose={() => setPicking(false)}
        />
      )}
      {reading && (
        <AttachmentReader
          tenant={tenant}
          file={reading}
          conversation={reading.attachmentConversationId || undefined}
          close={() => setReading(undefined)}
        />
      )}
    </div>
  );
}

export function ContinueWithMaterial({
  tenant,
  space,
  material,
  version,
  close,
}: {
  tenant: string;
  space: string;
  material: string;
  version: string;
  close?: () => void;
}) {
  const { session } = useSession();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  return (
    <>
      <Button
        disabled={busy}
        onClick={async () => {
          const actor = session.identity?.account.id;
          if (!actor) return;
          setBusy(true);
          setError(undefined);
          try {
            const v = await materialClient.version(tenant, space, material, version);
            const key = `dreamcore:composer:${actor}:${tenant}:new`,
              prior = readTabDraft(key),
              draft = record(prior.value) ? prior.value : {};
            if (draft.pending) throw new Error('已有发送结果待核对，请先回到会话处理。');
            const files = Array.isArray(draft.originals)
              ? draft.originals.filter(isOriginal).filter((f) => f.materialId !== material)
              : [];
            if (files.length >= 3) throw new Error('会话草稿已有三份资料，请先移除一份。');
            if (
              !writeTabDraft(key, {
                ...draft,
                originals: [
                  ...files,
                  {
                    materialId: material,
                    workspaceId: space,
                    versionId: version,
                    filename: v.filename,
                    version: v.number,
                    bytes: v.sizeBytes,
                    sha256: v.sha256,
                    read: false,
                  },
                ],
              })
            )
              throw new Error('浏览器未能保留资料引用，请在会话内选择此资料。');
            close?.();
            location.hash =
              conversationHref(tenant) +
              (new URLSearchParams(location.hash.slice(1)).get('view') === 'briefing'
                ? '&from=briefing'
                : '');
          } catch (e) {
            setError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        基于这份资料发起会话
      </Button>
      <SubmitError error={error} uncertain={false} />
    </>
  );
}

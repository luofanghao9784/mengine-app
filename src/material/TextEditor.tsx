import { useState } from 'react';
import { materialClient as api } from './client';
import { Failure, Loading, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { requestNavigationLocked, useRequestLock } from '../shared/request-guard';
import { Button, Modal } from '../shared/ui';

export function MaterialTextEditor({
  tenant,
  workspace,
  material,
  close,
  completed,
}: {
  tenant: string;
  workspace: string;
  material: string;
  close: () => void;
  completed: () => void;
}) {
  const [revision, refresh] = useState(0);
  const source = useRemote(
    (signal) => api.editableText(tenant, workspace, material, signal),
    [tenant, workspace, material, revision],
  );
  const [content, setContent] = useState<string>();
  const submit = useSubmission<{ content: string; filename: string; version: number }>();
  useRequestLock(submit.busy || submit.uncertain);
  const value = content ?? source.value?.content ?? '';
  const oversized = new TextEncoder().encode(value).length > 262144;
  return (
    <Modal
      title="编辑资料正文"
      wide
      onClose={() => {
        if (!requestNavigationLocked()) close();
      }}
    >
      <p>
        仅编辑 UTF-8 文本（TXT / Markdown，最多 256
        KB）。保存为新版本，保留原版本并重新解析；标签和复核信息在资料治理中维护。
      </p>
      {source.error ? (
        <Failure error={source.error} retry={() => refresh((n) => n + 1)} />
      ) : !source.value ? (
        <Loading />
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const current = source.value!;
            void submit.submit(
              { content: value, filename: current.filename, version: current.version },
              async (body, requestId) => {
                await api.upload(
                  tenant,
                  workspace,
                  { requestId, expectedVersion: body.version },
                  new File([body.content], body.filename, { type: 'text/plain;charset=utf-8' }),
                  material,
                );
                completed();
              },
            );
          }}
        >
          <p>
            {source.value.filename} · 基于 v{source.value.version}
          </p>
          <label>
            资料正文
            <textarea
              aria-label="资料正文"
              rows={12}
              style={{ width: '100%', boxSizing: 'border-box', minHeight: 160, maxHeight: '40dvh' }}
              value={value}
              disabled={submit.busy || submit.uncertain}
              onChange={(e) => setContent(e.target.value)}
            />
          </label>
          {oversized && <p role="alert">正文超过 256 KB，请缩减后保存。</p>}
          <SubmitError error={submit.error} uncertain={submit.uncertain} />
          <div className="modal-actions">
            <Button disabled={submit.busy || submit.uncertain} onClick={close}>
              取消
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={submit.busy || (!submit.uncertain && (oversized || value === source.value.content))}
            >
              {submit.busy ? '正在保存…' : submit.uncertain ? '重试本次保存' : '保存新版本'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

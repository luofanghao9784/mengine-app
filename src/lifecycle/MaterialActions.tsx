import { LibraryMove } from '../material/Move';
import { useLibraryPermissionsEnabled } from '../material/Permissions';
import { useContext, useRef, useState } from 'react';
import { MoreHorizontal, Trash2 } from 'lucide-react';
import type {
  LifecycleItem,
  LifecycleAction,
  MaterialObjectKind,
} from '../../contracts/public-api/lifecycle';
import { Button, IconButton, Modal } from '../shared/ui';
import { ActionPopover } from '../shared/ActionPopover';
import { Failure, Loading, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { RequestPending, useRequestLock } from '../shared/request-guard';
import { lifecycleClient as api } from './client';
import './recycle.css';

export function MaterialEntryActions({
  tenant,
  workspace,
  id,
  kind,
  name,
  changed,
}: {
  tenant: string;
  workspace: string;
  id: string;
  kind: MaterialObjectKind;
  name: string;
  changed: () => void;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [move, setMove] = useState(false);
  const permissionEnabled = useLibraryPermissionsEnabled(tenant);
  const pending = useContext(RequestPending);
  return (
    <>
      <div ref={anchor} className="material-entry-actions">
        <IconButton
          icon={MoreHorizontal}
          label={`资料操作 ${name}`}
          aria-expanded={open}
          disabled={pending}
          onClick={() => setOpen(!open)}
        />
        {open && (
          <ActionPopover anchor={anchor} label={`资料操作 ${name}`} onClose={() => setOpen(false)}>
            {permissionEnabled && (
              <Button
                onClick={() => {
                  setOpen(false);
                  setMove(true);
                }}
              >
                移动
              </Button>
            )}
            <Button
              icon={Trash2}
              onClick={() => {
                setOpen(false);
                setConfirm(true);
              }}
            >
              删除
            </Button>
          </ActionPopover>
        )}
      </div>
      {move && (
        <LibraryMove
          tenant={tenant}
          workspace={workspace}
          id={id}
          kind={kind}
          name={name}
          close={() => setMove(false)}
          changed={changed}
        />
      )}
      {confirm && (
        <MaterialActionDialog
          tenant={tenant}
          workspace={workspace}
          selection={{ id, kind }}
          action="TRASH"
          close={() => setConfirm(false)}
          changed={() => {
            setConfirm(false);
            changed();
          }}
        />
      )}
    </>
  );
}

/** Read the current revision before confirming a destructive action; never assume a cached item is active. */
export function MaterialActionDialog({
  tenant,
  workspace,
  selection,
  action,
  close,
  changed,
}: {
  tenant: string;
  workspace: string;
  selection: Pick<LifecycleItem, 'id' | 'kind'>;
  action: 'TRASH' | 'PURGE';
  close: () => void;
  changed: () => void;
}) {
  const [revision, setRevision] = useState(0);
  const data = useRemote(
    (signal) => api.preview(tenant, workspace, selection.kind, selection.id, signal),
    [tenant, workspace, selection.kind, selection.id, revision],
  );
  const mutation = useLifecycleAction(tenant, workspace, selection, changed);
  const allowed =
    data.value &&
    (action === 'TRASH'
      ? data.value.item.state === 'ACTIVE'
      : data.value.item.state === 'TRASHED' && data.value.item.canPurge);
  const title = action === 'TRASH' ? '删除资料' : '彻底删除';
  return (
    <Modal
      title={title}
      className="material-action-dialog"
      onClose={() => {
        if (!mutation.locked) close();
      }}
    >
      {data.error ? (
        <Failure error={data.error} retry={() => setRevision((x) => x + 1)} />
      ) : !data.value ? (
        <Loading />
      ) : (
        <>
          <p className="material-action-name">{data.value.item.name}</p>
          <p>
            {action === 'TRASH'
              ? selection.kind === 'FOLDER'
                ? `文件夹及其中的 ${data.value.documents} 份资料将移入回收站，停止读取和任务使用。`
                : '资料将移入回收站，停止读取和任务使用。'
              : '将清理在线原件及受其约束的派生内容，无法恢复。独立发布副本和备份按各自规则保留。'}
          </p>
          {!allowed && <p role="alert">当前状态或权限已变化，请返回资料库刷新。</p>}
          <SubmitError error={mutation.error} uncertain={mutation.uncertain} />
          <div className="modal-actions">
            <Button disabled={mutation.locked} onClick={close}>
              取消
            </Button>
            <Button
              variant="danger"
              disabled={mutation.busy || (!mutation.uncertain && (!allowed || mutation.otherPending))}
              onClick={() => void mutation.run(data.value!.item.revision, action)}
            >
              {mutation.busy
                ? '正在处理…'
                : mutation.uncertain
                  ? '重试同一次操作'
                  : title === '删除资料'
                    ? '删除'
                    : title}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

export function useLifecycleAction(
  tenant: string,
  workspace: string,
  item: Pick<LifecycleItem, 'kind' | 'id'>,
  changed: () => void,
) {
  const submit = useSubmission<{ expectedRevision: number; action: LifecycleAction }>();
  const pending = useContext(RequestPending);
  useRequestLock(submit.busy || submit.uncertain);
  return {
    ...submit,
    locked: submit.busy || submit.uncertain,
    otherPending: pending && !submit.uncertain,
    run: (revision: number, action: LifecycleAction) =>
      submit.submit({ expectedRevision: revision, action }, async (body, requestId) => {
        await api.act(tenant, workspace, item.kind, item.id, { ...body, requestId });
        changed();
      }),
  };
}

import { useState } from 'react';
import { createIdentityRequest, record, uuid } from '../identity/client';
import { Button, Badge } from '../shared/ui';
import { Failure, Loading, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { useRequestLock } from '../shared/request-guard';
type State = { id: string; archived: boolean; revision: number; dependentRecords: number };
const valid = (v: unknown): v is State =>
  record(v) &&
  uuid(v.id) &&
  typeof v.archived === 'boolean' &&
  Number.isSafeInteger(v.revision) &&
  Number(v.revision) >= 0 &&
  Number.isSafeInteger(v.dependentRecords) &&
  Number(v.dependentRecords) >= 0;
const request = createIdentityRequest();
export const readWorkspaceArchive = (tenant: string, id: string, signal?: AbortSignal) =>
  request(`/api/tenant-admin/v1/tenants/${tenant}/workspaces/${id}/archive`, 'GET', valid, undefined, signal);
export function WorkspaceArchive({
  tenant,
  id,
  onChange,
}: {
  tenant: string;
  id: string;
  onChange: () => void;
}) {
  const [revision, setRevision] = useState(0),
    [confirm, setConfirm] = useState(false);
  const path = `/api/tenant-admin/v1/tenants/${tenant}/workspaces/${id}/archive`;
  const remote = useRemote(
    (signal) => request(path, 'GET', valid, undefined, signal),
    [tenant, id, revision],
  );
  const task = useSubmission<{ expectedRevision: number; archived: boolean }>();
  useRequestLock(task.busy || task.uncertain);
  if (remote.error) return <Failure error={remote.error} retry={() => setRevision((n) => n + 1)} />;
  if (!remote.value) return <Loading />;
  const item = remote.value;
  return (
    <section className="admin-section" aria-label="空间归档">
      <h3>
        空间归档 <Badge>{item.archived ? '已归档' : '使用中'}</Badge>
      </h3>
      <p className="admin-note">
        归档后从员工空间列表移除，并阻止新增业务内容。成员授权保留，恢复后可继续使用。当前只允许归档没有业务关联记录的共享空间。
      </p>
      {item.dependentRecords > 0 && !item.archived ? (
        <p className="admin-note">
          存在 {item.dependentRecords}{' '}
          条关联记录，暂不能归档。请先核对资料、任务和数据来源；归档不会代替删除。
        </p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void task.submit(
              { expectedRevision: item.revision, archived: !item.archived },
              async (body, requestId) => {
                await request(path, 'POST', valid, { ...body, requestId });
                setConfirm(false);
                setRevision((n) => n + 1);
                onChange();
              },
            );
          }}
        >
          <label>
            <input
              type="checkbox"
              required
              checked={confirm}
              disabled={task.busy || task.uncertain}
              onChange={(e) => setConfirm(e.target.checked)}
            />
            确认{item.archived ? '恢复' : '归档'}此空间
          </label>
          <div className="form-actions">
            <Button type="submit" disabled={!confirm || task.busy}>
              {task.busy
                ? '正在处理…'
                : task.uncertain
                  ? '核对并重试'
                  : item.archived
                    ? '恢复空间'
                    : '归档空间'}
            </Button>
          </div>
        </form>
      )}
      <SubmitError error={task.error} uncertain={task.uncertain} />
    </section>
  );
}

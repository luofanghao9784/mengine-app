import { useState } from 'react';
import { databaseClient as api, type DatasetLifecycle } from './client';
import { Button, Badge, Modal } from '../shared/ui';
import { Failure, Loading, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { useRequestLock } from '../shared/request-guard';

export function DatasetLifecyclePanel({ tenant, id }: { tenant: string; id?: string }) {
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<DatasetLifecycle>();
  const remote = useRemote(
    async (signal) => (id ? [await api.lifecycle(tenant, id, signal)] : api.lifecycleRecords(tenant, signal)),
    [tenant, id, revision],
  );
  return (
    <section className="admin-section" aria-label="数据集生命周期">
      {!id && (
        <>
          <h2>撤下与清理</h2>
          <p className="admin-note">
            显示当前获权范围内的清理记录（最多 100
            条）。撤下会阻断使用；清理正文不可恢复，备份副本需单独处理。
          </p>
        </>
      )}
      {remote.error ? (
        <Failure error={remote.error} retry={() => setRevision((n) => n + 1)} />
      ) : !remote.value ? (
        <Loading />
      ) : remote.value.length === 0 ? (
        <p className="admin-note">暂无撤下或清理记录。</p>
      ) : (
        remote.value.map((item) => (
          <div className="admin-account-record" key={item.id}>
            <strong>{item.name}</strong>{' '}
            <Badge>
              {{ ACTIVE: '使用中', WITHDRAWN: '已撤下 · 正文保留', PURGED: '在线正文已清理' }[item.state]}
            </Badge>
            <p className="admin-note">
              {item.snapshots} 个历史快照 · 在线正文 {item.rows.toLocaleString('zh-CN')} 行
            </p>
            {(item.canWithdraw || item.canPurge) && (
              <Button onClick={() => setSelected(item)}>
                {item.canWithdraw ? '撤下数据集' : '清理在线正文'}
              </Button>
            )}
          </div>
        ))
      )}
      {selected && (
        <LifecycleConfirm
          tenant={tenant}
          item={selected}
          close={() => setSelected(undefined)}
          done={() => {
            setSelected(undefined);
            setRevision((n) => n + 1);
            window.dispatchEvent(new Event('focus'));
          }}
        />
      )}
    </section>
  );
}
function LifecycleConfirm({
  tenant,
  item,
  close,
  done,
}: {
  tenant: string;
  item: DatasetLifecycle;
  close: () => void;
  done: () => void;
}) {
  const task = useSubmission<{ expectedRevision: number; action: string; confirmed: boolean }>();
  const [confirmed, setConfirmed] = useState(false);
  useRequestLock(task.busy || task.uncertain);
  const purge = item.state === 'WITHDRAWN';
  return (
    <Modal
      title={purge ? '清理数据集在线正文' : '撤下数据集'}
      onClose={() => {
        if (!task.busy && !task.uncertain) close();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void task.submit(
            { expectedRevision: item.revision, action: purge ? 'PURGE' : 'WITHDRAW', confirmed },
            async (body, requestId) => {
              await api.lifecycleAction(tenant, item.id, { ...body, requestId });
              done();
            },
          );
        }}
      >
        <p>{item.name}</p>
        <p className="admin-note">
          {purge
            ? `将清除 ${item.snapshots} 个快照中的 ${item.rows} 行正文，并清理依赖这些数据的任务内容与缓存。此操作不可恢复，保留审计记录；不删除外部源数据库及备份。`
            : '撤下后停止采集此数据集，已有任务将失去该来源访问权。同一连接正在执行的采集会中断，其余数据集可重新更新。历史正文保留，可在“撤下与清理”中继续清理；重新接入须部署新的数据集。'}
        </p>
        <label>
          <input
            type="checkbox"
            required
            checked={confirmed}
            disabled={task.busy || task.uncertain}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          我已确认影响范围{purge ? '及不可恢复性' : ''}
        </label>
        <SubmitError error={task.error} uncertain={task.uncertain} />
        <div className="modal-actions">
          <Button disabled={task.busy || task.uncertain} onClick={close}>
            取消
          </Button>
          <Button type="submit" variant={purge ? 'danger' : 'primary'} disabled={task.busy || !confirmed}>
            {task.busy ? '正在处理…' : task.uncertain ? '核对并重试' : purge ? '确认清理' : '确认撤下'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

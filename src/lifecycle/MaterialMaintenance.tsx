import { useState, useEffect, useRef } from 'react';
import type { MaterialEntry } from '../../contracts/public-api/material';
import type { MaterialObjectKind, LifecycleAction } from '../../contracts/public-api/lifecycle';
import { Button, Modal } from '../shared/ui';
import { useRemote, useSubmission, SubmitError, Loading, Failure, Pager } from '../shared/admin';
import { lifecycleClient as api } from './client';
import './lifecycle.css';
const states = { ACTIVE: '正常使用', TRASHED: '回收期内', PURGING: '正在清理', PURGED: '在线内容已清理' };
const actions: Record<LifecycleAction, string> = {
  TRASH: '移入回收站',
  RESTORE: '恢复资料',
  PURGE: '提前彻底清理',
  RETRY_CLEANUP: '重试在线清理',
};
const when = (v: string | null) => (v ? new Date(v).toLocaleString('zh-CN') : '—');
export function MaterialMaintenance({
  tenant,
  workspace,
  entries,
  recycleOnly = false,
  verification,
  close,
  changed,
}: {
  tenant: string;
  workspace: string;
  entries: MaterialEntry[];
  recycleOnly?: boolean;
  verification: unknown;
  close: () => void;
  changed: () => void;
}) {
  const [selection, setSelection] = useState<{ id: string; kind: MaterialObjectKind }>();
  const [page, setPage] = useState(0),
    [refresh, setRefresh] = useState(0),
    [notice, setNotice] = useState('');
  const recycle = useRemote(
    (signal) => api.list(tenant, workspace, page * 20, signal),
    [tenant, workspace, page, refresh, verification],
  );
  return (
    <Modal title="资料维护与回收站" onClose={close} wide>
      <div className="lifecycle-modal">
        <p>
          删除后停止正常读取、检索、下载和任务使用。回收期从删除生效起计算；恢复按当前权限生效，不自动重启任务。
        </p>
        {notice && <p role="status">{notice}</p>}
        {selection ? (
          <LifecycleObject
            key={selection.kind + selection.id}
            tenant={tenant}
            workspace={workspace}
            selection={selection}
            verification={verification}
            back={() => setSelection(undefined)}
            changed={(message) => {
              setNotice(message);
              setRefresh((x) => x + 1);
              changed();
            }}
          />
        ) : (
          <>
            {!recycleOnly && <h3>当前列表的资料</h3>}
            <ul className="lifecycle-list">
              {entries.map((e) => (
                <li key={e.id}>
                  <span>{e.name}</span>
                  <Button
                    onClick={() =>
                      setSelection({ id: e.id, kind: e.kind === 'FOLDER' ? 'FOLDER' : 'MATERIAL' })
                    }
                  >
                    管理 {e.name}
                  </Button>
                </li>
              ))}
            </ul>
            {!recycleOnly && !entries.length && <p>当前目录没有资料。可返回资料库选择其他目录。</p>}
            <h3>回收与清理记录</h3>
            {recycle.error ? (
              <Failure error={recycle.error} retry={() => setRefresh((x) => x + 1)} />
            ) : !recycle.value ? (
              <Loading />
            ) : (
              <>
                <ul className="lifecycle-list">
                  {recycle.value.items.map((e) => (
                    <li key={e.kind + e.id}>
                      <div>
                        <strong>{e.name}</strong>
                        <small>
                          {states[e.state]} · 回收截止 {when(e.purgeAfter)}
                        </small>
                      </div>
                      <Button onClick={() => setSelection({ id: e.id, kind: e.kind })}>查看状态</Button>
                    </li>
                  ))}
                </ul>
                {!recycle.value.items.length && <p>此空间没有回收或清理记录。</p>}
                <Pager page={page} next={recycle.value.hasMore} onPage={setPage} />
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
function LifecycleObject({
  tenant,
  workspace,
  selection,
  verification,
  back,
  changed,
}: {
  tenant: string;
  workspace: string;
  selection: { id: string; kind: MaterialObjectKind };
  verification: unknown;
  back: () => void;
  changed: (message: string) => void;
}) {
  const [refresh, setRefresh] = useState(0),
    [confirm, setConfirm] = useState<LifecycleAction>();
  const data = useRemote(
    (signal) => api.preview(tenant, workspace, selection.kind, selection.id, signal),
    [tenant, workspace, selection.id, refresh, verification],
  );
  const submit = useSubmission<{ action: LifecycleAction; expectedRevision: number }>();
  const signal = useRef(new AbortController());
  useEffect(() => () => signal.current.abort(), []);
  const update = () => setRefresh((x) => x + 1);
  return (
    <div className="lifecycle-object">
      <Button onClick={back} disabled={submit.busy || submit.uncertain}>
        返回维护列表
      </Button>
      {data.error ? (
        <Failure error={data.error} retry={update} />
      ) : !data.value ? (
        <Loading />
      ) : (
        <>
          <h3>{data.value.item.name}</h3>
          <p>{states[data.value.item.state]}</p>
          <dl>
            <dt>涉及资料</dt>
            <dd>
              {data.value.documents} 份 · {data.value.versions} 个原件版本 · {data.value.folders} 个文件夹
            </dd>
            <dt>回收截止</dt>
            <dd>{when(data.value.item.purgeAfter)}</dd>
          </dl>
          <p>受这些资料约束的私人任务和成果会停止读取。已经明确发布的独立企业副本继续按其所在空间管理。</p>
          {data.value.item.cleanupJobId && (
            <MaterialCleanupStatus
              tenant={tenant}
              workspace={workspace}
              job={data.value.item.cleanupJobId}
              verification={verification}
              changed={update}
            />
          )}
          {!confirm ? (
            <div className="lifecycle-actions">
              {data.value.item.state === 'ACTIVE' && (
                <Button onClick={() => setConfirm('TRASH')}>移入回收站</Button>
              )}
              {data.value.item.state === 'TRASHED' && (
                <>
                  <Button onClick={() => setConfirm('RESTORE')}>恢复资料</Button>
                  {data.value.item.canPurge && (
                    <Button onClick={() => setConfirm('PURGE')}>提前彻底清理</Button>
                  )}
                </>
              )}
              {data.value.item.state === 'PURGING' && data.value.item.canPurge && (
                <Button onClick={() => setConfirm('RETRY_CLEANUP')}>重试失败的清理</Button>
              )}
            </div>
          ) : (
            <section className="lifecycle-confirm">
              <strong>{actions[confirm]}</strong>
              <p>
                {confirm === 'TRASH'
                  ? '移入回收站后立即停止使用，并按本次生效的保留政策确定清理截止。'
                  : confirm === 'PURGE'
                    ? '这会提前清理在线原件及受其约束的派生内容，不能恢复。备份清理状态另行核对。'
                    : confirm === 'RESTORE'
                      ? '恢复仍存在的资料；单独删除的子项、已撤销的授权和旧任务不会自动恢复。'
                      : '仅重试已失败的清理；已经删除的原件不会重新生成。'}
              </p>
              <SubmitError error={submit.error} uncertain={submit.uncertain} />
              <div className="lifecycle-actions">
                <Button disabled={submit.busy || submit.uncertain} onClick={() => setConfirm(undefined)}>
                  返回
                </Button>
                <Button
                  variant="primary"
                  disabled={submit.busy}
                  onClick={() =>
                    void submit.submit(
                      { action: confirm, expectedRevision: data.value!.item.revision },
                      async (body, requestId) => {
                        const receipt = await api.act(
                          tenant,
                          workspace,
                          selection.kind,
                          selection.id,
                          { ...body, requestId },
                          signal.current.signal,
                        );
                        changed(`操作回执已保存：${actions[receipt.action]}。当前状态以下方重新读取为准。`);
                        setConfirm(undefined);
                        update();
                      },
                    )
                  }
                >
                  {submit.uncertain ? '重试同一次操作' : `确认${actions[confirm]}`}
                </Button>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
export function MaterialCleanupStatus({
  tenant,
  workspace,
  job,
  verification,
  changed,
}: {
  tenant: string;
  workspace: string;
  job: string;
  verification: unknown;
  changed: () => void;
}) {
  const [refresh, setRefresh] = useState(0);
  const data = useRemote(
    (signal) => api.cleanup(tenant, workspace, job, signal),
    [tenant, workspace, job, refresh, verification],
  );
  useEffect(() => {
    if (data.value && ['QUEUED', 'CLEANING'].includes(data.value.state)) {
      const timer = setTimeout(() => setRefresh((x) => x + 1), 5000);
      return () => clearTimeout(timer);
    }
  }, [data.value]);

  return data.error ? (
    <Failure error={data.error} retry={() => setRefresh((x) => x + 1)} />
  ) : !data.value ? (
    <Loading />
  ) : (
    <section className="lifecycle-cleanup">
      <p>
        在线清理：
        {
          { QUEUED: '已排队', CLEANING: '进行中', FAILED: '失败，保留已完成记录', COMPLETE: '已完成' }[
            data.value.state
          ]
        }{' '}
        · 原件 {data.value.originalsRemoved}/{data.value.originals}
      </p>
      <p>这份回执不代表备份已清理。</p>
      <Button
        onClick={() => {
          setRefresh((x) => x + 1);
          changed();
        }}
      >
        刷新清理状态
      </Button>
    </section>
  );
}

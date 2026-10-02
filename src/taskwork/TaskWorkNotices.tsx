import { PlanCard } from '../plans/Plans';
import { featureEntries } from '../shared/feature-entries';
import { isPlan, statusLabels } from '../plans/client';
import type { Plan } from '../../contracts/public-api/plans';
import { createIdentityRequest, record } from '../identity/client';
const readPlanReceipts = createIdentityRequest();
import { useState } from 'react';
import { CalendarClock, Check, Undo2 } from 'lucide-react';
import { Button } from '../shared/ui';
import { Failure, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { useRequestLock } from '../shared/request-guard';
import { useSession } from '../identity/session';
import { taskWorkClient as api } from './client';
import './taskwork.css';
export function TaskWorkNotices(props: { tenant: string; task: string; verification?: unknown }) {
  return (
    <>
      <PlanReceipts {...props} />
      <Notices key={`${props.tenant}:${props.task}`} {...props} />
    </>
  );
}
function Notices({ tenant, task, verification }: { tenant: string; task: string; verification?: unknown }) {
  const { session } = useSession();
  const [attempt, setAttempt] = useState(0),
    [page, setPage] = useState(0),
    [notice, setNotice] = useState(''),
    [undoId, setUndoId] = useState<string>();
  const submission = useSubmission<string>(),
    blocked = submission.busy || submission.uncertain;
  useRequestLock(blocked);
  const refresh = () => setAttempt((n) => n + 1);
  const undo = (id: string) => {
    setUndoId(id);
    void submission.submit(id, async (receipt, key) => {
      await api.undo(tenant, task, receipt, key);
      setNotice('已撤销此版本的个人偏好。');
      setUndoId(undefined);
      refresh();
    });
  };
  const receipt = useRemote(
    (signal) => api.list(tenant, task, page * 20, signal),
    [tenant, task, page, attempt, verification, session.identity],
  );
  if (receipt.error)
    return (
      <div className="taskwork-notices">
        <Failure error={receipt.error} retry={refresh} />
      </div>
    );
  if (!receipt.value) return null;
  const data = receipt.value;
  if (!data.checks.length && !data.preferences.length && !page) return null;
  return (
    <aside className="taskwork-notices" aria-label="本任务的实际保存回执">
      <div className="taskwork-heading">
        <strong>已保存的安排与偏好</strong>
        <span>以系统回执为准</span>
      </div>
      {data.checks.map((r) => (
        <div className="taskwork-item" key={r.id}>
          <CalendarClock size={17} />
          <div>
            <strong>
              {r.state === 'DISPATCHED'
                ? '后续检查已派发'
                : r.currentlyEffective
                  ? '已安排一次后续检查'
                  : '后续检查已失效或取消'}
            </strong>
            <p>{new Date(r.checkAt).toLocaleString('zh-CN', { hour12: false })} · 原计划范围内</p>
            <details>
              <summary>查看安排依据</summary>
              <p>{r.reason || '原说明已清理。'}</p>
              <p>
                接受时计划修订 {r.acceptedRevision}
                。安排被接受不代表后续任务已完成，执行仍需通过原计划权限、时限与额度检查。
              </p>
              {r.dispatchUnavailable && <p>已派发；原任务不在本次恢复数据中。</p>}
              {featureEntries.ongoingPlans && (
                <a href={`/workspace/#tenant=${tenant}&view=plans`}>查看我的持续计划</a>
              )}
            </details>
          </div>
        </div>
      ))}
      {data.preferences.map((r) => (
        <div className="taskwork-item" key={r.id}>
          <Check size={17} />
          <div>
            <strong>{r.label}</strong>
            <p>
              {r.currentlyEffective
                ? '已保存到我的个人偏好'
                : r.currentStatus === 'UNAVAILABLE'
                  ? '原偏好版本已停用、回收或清理'
                  : r.currentStatus === 'WITHDRAWN'
                    ? '已撤销此偏好'
                    : '此回执对应版本已被后续修改取代'}{' '}
              · 接受版本 {r.acceptedRevision}
            </p>
            <details>
              <summary>查看保存依据</summary>
              <p>
                依据：本人在{r.evidenceSource === 'PROMPT' ? '本次输入' : '本任务补充'}
                中明确要求长期保存。仅保存表达倾向，不代表新增工作委托或权限。
              </p>
              <p>
                当前个人档案版本 {r.currentRevision}；
                {r.currentlyEffective ? '此版本正在生效。' : '历史保存回执不代表仍在生效。'}
              </p>
              <a href={`/workspace/#tenant=${tenant}&view=profiles`}>查看我的档案与偏好</a>
            </details>
            {r.canUndo && (
              <Button icon={Undo2} disabled={blocked} onClick={() => undo(r.id)}>
                撤销这次偏好保存
              </Button>
            )}
          </div>
        </div>
      ))}
      {notice && <p role="status">{notice}</p>}
      <SubmitError error={submission.error} uncertain={submission.uncertain} />
      {submission.uncertain && undoId && (
        <Button disabled={submission.busy} onClick={() => undo(undoId)}>
          重试本次偏好撤销
        </Button>
      )}
      <div className="taskwork-pagination">
        <Button disabled={blocked || !page} onClick={() => setPage(page - 1)}>
          上一页
        </Button>
        <span>第 {page + 1} 页</span>
        <Button disabled={blocked || !data.hasMore} onClick={() => setPage(page + 1)}>
          下一页
        </Button>
      </div>
    </aside>
  );
}

function PlanReceipts({
  tenant,
  task,
  verification,
}: {
  tenant: string;
  task: string;
  verification?: unknown;
}) {
  const { session } = useSession();
  const [opened, setOpened] = useState<string>(),
    [attempt, setAttempt] = useState(0);
  const data = useRemote(
    (signal) =>
      readPlanReceipts(
        `/api/v1/tenants/${tenant}/tasks/${task}/plan-receipts`,
        'GET',
        (
          v,
        ): v is { action: string; acceptedRevision: number; plan: Plan; changedSinceAcceptance: boolean }[] =>
          Array.isArray(v) &&
          v.length <= 1 &&
          v.every(
            (r) =>
              record(r) &&
              isPlan(r.plan) &&
              r.plan.tenantId === tenant &&
              r.plan.ownerId === session.identity?.account.id,
          ),
        undefined,
        signal,
      ),
    [tenant, task, verification, session.identity, attempt],
  );
  if (data.error) return <Failure error={data.error} retry={() => setAttempt((n) => n + 1)} />;
  return (
    <>
      {data.value?.map((r) => (
        <article className="taskwork-item" key={r.plan.id}>
          <CalendarClock size={18} />
          <div>
            <strong>{r.plan.configuration.goal}</strong>
            <p>
              {statusLabels[r.plan.status]} ·{' '}
              {r.plan.configuration.dailyTime ? `每天 ${r.plan.configuration.dailyTime}` : '资料变化时'} ·
              下次：{r.plan.nextDue ? new Date(r.plan.nextDue).toLocaleString('zh-CN') : '等待触发'}
            </p>
            <small>
              仅本人在系统内查看 · 截至 {new Date(r.plan.configuration.expiresAt).toLocaleDateString('zh-CN')}
            </small>
            {featureEntries.ongoingPlans && <Button onClick={() => setOpened(r.plan.id)}>查看计划</Button>}
          </div>
        </article>
      ))}
      {featureEntries.ongoingPlans && opened && (
        <PlanCard
          tenant={tenant}
          owner={session.identity!.account.id}
          id={opened}
          close={() => setOpened(undefined)}
          onChanged={() => setAttempt((n) => n + 1)}
        />
      )}
    </>
  );
}

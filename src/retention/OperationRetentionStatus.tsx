import { useState } from 'react';
import { Button } from '../shared/ui';
import { useRemote, Failure, Loading } from '../shared/admin';
import { getOperationRetention } from './operations-client';
export function OperationRetentionStatus({
  tenant = null,
  revision = 0,
}: {
  tenant?: string | null;
  revision?: number;
}) {
  const [attempt, setAttempt] = useState(0);
  const data = useRemote((signal) => getOperationRetention(tenant, signal), [tenant, revision, attempt]);
  return (
    <section className="operations-block" aria-label="任务通知清理状态">
      <h3>任务通知清理</h3>
      <p className="muted">
        仅清理已到期的闭合任务通知和重复操作记录。任务结果、用量、幂等及权限与删除记录继续按用途保留。
      </p>
      {data.error ? (
        <Failure error={data.error} retry={() => setAttempt((n) => n + 1)} />
      ) : !data.value ? (
        <Loading />
      ) : (
        <>
          <p>
            等待到期 {data.value.pending} · 清理失败 {data.value.failed} · 已完成 {data.value.complete}
          </p>
          <p>
            已清理通知 {data.value.removedEvents} 条、重复操作记录 {data.value.removedAudit} 条。
          </p>
          <p>
            下一截止：
            {data.value.nextDeadline ? new Date(data.value.nextDeadline).toLocaleString('zh-CN') : '暂无'}
          </p>
          <p className="muted">
            仅统计启用保留规则后产生的记录；读取和重试不会延长原截止。失败项由后台重试，此状态不代表备份已清理。
          </p>
          <Button onClick={() => setAttempt((n) => n + 1)}>刷新清理统计</Button>
        </>
      )}
    </section>
  );
}

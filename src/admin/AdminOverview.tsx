import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useRemote, Failure, Loading } from '../shared/admin';
import { Button, PageActions } from '../shared/ui';
import { tenantClient } from '../tenant/client';
import { platformClient } from '../platform/client';
import { getOperations } from '../operations/client';
import { adminHref, type AdminRealm } from './navigation';

export function AdminOverview({
  realm,
  tenant,
  hash,
  responsibilityPending = false,
}: {
  realm: AdminRealm;
  tenant?: string;
  hash: string;
  responsibilityPending?: boolean;
}) {
  const [attempt, setAttempt] = useState(0);
  const summary = useRemote(
    async (signal) =>
      realm === 'tenant'
        ? { kind: 'tenant' as const, value: await tenantClient.overview(tenant!, signal) }
        : { kind: 'platform' as const, value: await platformClient.overview(signal) },
    [realm, tenant, attempt],
  );
  const operations = useRemote(
    (signal) => getOperations(realm, tenant || null, 7, signal),
    [realm, tenant, attempt],
  );
  const refresh = () => setAttempt((n) => n + 1);
  return (
    <div className="admin-dashboard">
      <PageActions>
        <Button variant="ghost" icon={RefreshCw} onClick={refresh}>
          刷新
        </Button>
      </PageActions>
      {summary.error ? (
        <Failure error={summary.error} retry={refresh} />
      ) : !summary.value ? (
        <Loading />
      ) : (
        <div className="admin-stats">
          {summary.value.kind === 'tenant' ? (
            <>
              <Stat title="启用成员" value={summary.value.value.activeMemberCount} note="当前企业" />
              <Stat
                title="共享空间"
                value={summary.value.value.sharedWorkspaceCount}
                note="管理范围，不代表内容读取权"
              />
            </>
          ) : (
            <>
              <Stat title="服务企业" value={summary.value.value.totalTenants} note="当前已开通" />
              <Stat
                title="正常服务"
                value={summary.value.value.activeTenants}
                note={`${summary.value.value.suspendedTenants} 家已暂停`}
              />
            </>
          )}
          <Stat title="正在执行" value={operations.value?.tasks.running} note="近 7 天创建的任务" />
          <Stat title="排队任务" value={operations.value?.tasks.queued} note="近 7 天创建的任务" />
        </div>
      )}
      <section className="admin-section">
        <div className="admin-section-heading">
          <h2>需要关注</h2>
          <a href={adminHref(realm, 'engine', hash)}>查看运行状态</a>
        </div>
        {responsibilityPending && (
          <p>
            有一项负责人职责等待接受。
            <a href={adminHref(realm, 'members', hash, { detail: 'duties' })}>查看职责与交接</a>
          </p>
        )}
        {operations.error ? (
          <Failure error={operations.error} retry={refresh} />
        ) : !operations.value ? (
          <p className="admin-note">正在获取运行信息…</p>
        ) : (
          <>
            {operations.value.tasks.resultUnknown > 0 && (
              <p>{operations.value.tasks.resultUnknown} 项任务的执行结果尚未确认，可在运行页核对。</p>
            )}
            {operations.value.tasks.waitingCapability > 0 && (
              <p>{operations.value.tasks.waitingCapability} 项任务等待可用能力。</p>
            )}
            {!operations.value.tasks.resultUnknown &&
              !operations.value.tasks.waitingCapability &&
              !responsibilityPending && (
                <p className="admin-note">当前运行记录中没有待确认结果或能力等待。</p>
              )}
            <small className="admin-note">
              依据最近 7 天任务记录，更新于{' '}
              {new Date(operations.value.checkedAt).toLocaleString('zh-CN', { hour12: false })}
              。正常排队和历史失败不自动转为人工待办。
            </small>
          </>
        )}
      </section>
      <section className="admin-section">
        <h2>常用入口</h2>
        <div className="admin-shortcuts">
          {realm === 'tenant' ? (
            <>
              <a className="button" href={adminHref(realm, 'members', hash, { tab: 'invitations' })}>
                成员邀请
              </a>
              <a className="button" href={adminHref(realm, 'members', hash, { tab: 'spaces' })}>
                共享空间
              </a>
              <a className="button" href={adminHref(realm, 'database', hash)}>
                数据库
              </a>
              <a className="button" href={adminHref(realm, 'materials', hash, { scope: 'enterprise' })}>
                资料库
              </a>
            </>
          ) : (
            <>
              <a className="button" href={adminHref(realm, 'tenants', hash)}>
                企业管理
              </a>
              <a className="button" href={adminHref(realm, 'engine', hash)}>
                运行监控
              </a>
              <a className="button" href={adminHref(realm, 'capabilities', hash)}>
                引擎管理
              </a>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
function Stat({ title, value, note }: { title: string; value: number | undefined; note: string }) {
  return (
    <div className="admin-stat">
      <span>{title}</span>
      <strong>{value === undefined ? '—' : value.toLocaleString('zh-CN')}</strong>
      <small>{value === undefined ? '暂未获取' : note}</small>
    </div>
  );
}

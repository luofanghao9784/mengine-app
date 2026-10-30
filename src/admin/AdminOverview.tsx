import { KnowledgeDashboard } from './mengine/KnowledgeDashboard';
import { useState } from 'react';
import { KnowledgeWorkbench } from './KnowledgeWorkbench';
import { useRemote, Failure, Loading } from '../shared/admin';
import { tenantClient } from '../tenant/client';
import { platformClient } from '../platform/client';
import { getTelemetry } from '../operations/telemetry-client';
import { usageClient } from '../operations/usage-client';
import { adminHref, type AdminRealm } from './navigation';
import { PlatformOverviewPage } from './PlatformOverviewPage';

export function AdminOverview(props: Parameters<typeof ScopedOverview>[0]) {
  if (props.realm === 'platform') return <PlatformOverviewPage hash={props.hash} />;
  const layout = new URLSearchParams(props.hash.slice(1)).get('layout') || 'dashboard';
  return (
    <>
      <nav className="platform-detail-nav" aria-label="工作台页面版本">
        {[
          ['dashboard', '知识仪表盘'],
          ['workbench', '资料工作台'],
          ['operations', '企业运行概览'],
        ].map(([key, label]) => (
          <a
            key={key}
            className="button ghost"
            aria-current={layout === key ? 'page' : undefined}
            href={adminHref('tenant', 'overview', props.hash, { layout: key })}
          >
            {label}
          </a>
        ))}
      </nav>
      {layout === 'workbench' ? (
        <KnowledgeWorkbench
          tenant={props.tenant!}
          hash={props.hash}
          responsibilityPending={props.responsibilityPending || false}
        />
      ) : layout === 'operations' ? (
        <ScopedOverview {...props} />
      ) : (
        <KnowledgeDashboard key={props.tenant} tenant={props.tenant!} hash={props.hash} />
      )}
    </>
  );
}

function ScopedOverview({
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
    (signal) => getTelemetry(realm, realm === 'tenant' ? tenant! : null, signal),
    [realm, tenant, attempt],
  );
  const usage = useRemote(
    (signal) => usageClient.read(realm, realm === 'tenant' ? tenant! : null, 'THIS_MONTH', signal),
    [realm, tenant, attempt],
  );
  const monthly = usage.value && ('usage' in usage.value ? usage.value.usage : usage.value);
  const work = monthly?.groups.find((g) => g.purpose === 'WORK' && g.executionClass === 'live');
  const maintenance = monthly?.groups.find((g) => g.purpose === 'MAINTENANCE' && g.executionClass === 'live');
  const totals = operations.value?.channels.reduce(
    (sum, c) => ({
      running: sum.running + c.running,
      queued: sum.queued + c.queued,
      waiting: sum.waiting + c.waiting,
      unknown: sum.unknown + c.unknown,
    }),
    { running: 0, queued: 0, waiting: 0, unknown: 0 },
  );
  const usageHref = adminHref(realm, 'usage', hash, {
    period: 'THIS_MONTH',
  });
  const refresh = () => setAttempt((n) => n + 1);
  return (
    <div className="admin-dashboard tenant-overview">
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
              <Stat
                title="服务企业"
                value={summary.value.value.totalTenants}
                note={`${summary.value.value.pendingTenants ?? 0} 家待激活`}
              />
              <Stat
                title="正常服务"
                value={summary.value.value.activeTenants}
                note={`${summary.value.value.suspendedTenants} 家已暂停`}
              />
            </>
          )}
          <Stat title="执行中" value={totals?.running} note="当前运行记录，与引擎运行页同口径" />
          <Stat title="排队中" value={totals?.queued} note="含输入、处理与输出，不代表物理并发" />
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
            {totals!.unknown > 0 && <p>{totals!.unknown} 项运行记录的结果尚未确认，可在运行页核对。</p>}
            {totals!.waiting > 0 && (
              <p>{totals!.waiting} 项运行记录处于等待状态，含暂停、补充信息或能力等待。</p>
            )}
            {!totals!.unknown && !totals!.waiting && !responsibilityPending && (
              <p className="admin-note">已接入的运行记录中暂无结果待确认或等待状态。</p>
            )}
            <small className="admin-note">
              快照更新于 {new Date(operations.value.checkedAt).toLocaleString('zh-CN', { hour12: false })}。
              不受任务创建日期限制；等待或排队不自动转为人工待办，不代表全部服务正常。
            </small>
          </>
        )}
      </section>
      <section className="admin-section" aria-label="本月用量摘要">
        <div className="admin-section-heading">
          <h2>本月用量</h2>
          <a href={usageHref}>查看本月用量</a>
        </div>
        {usage.error ? (
          <Failure error={usage.error} retry={refresh} />
        ) : !monthly ? (
          <Loading />
        ) : (
          <>
            <div className="admin-stats">
              <Stat title="今日模型请求" value={work?.modelCalls ?? 0} note="正式执行 · 包含失败与重试" />
              <Stat
                title="维护模型回执调用"
                value={maintenance?.modelCalls ?? undefined}
                note="正式执行 · 仅已收到的回执"
                missing={maintenance ? '回执调用数未知' : '暂无维护记录'}
              />
            </div>
            <p className="admin-note">
              {maintenance?.unknownCallUnits
                ? `${maintenance.unknownCallUnits} 次维护运行的调用数尚未知。`
                : ''}
              合成验证和旧类别未知另见明细；缺失回执不计为零。
            </p>
            <p className="admin-note">
              {realm === 'platform'
                ? '采购成本尚未接入，共享费用尚未分摊。'
                : '本企业额度及剩余额度尚未配置。'}
            </p>
            <small className="admin-note">
              {new Date(monthly.from).toLocaleString('zh-CN', { timeZone: monthly.timeZone, hour12: false })}
              {' 至 '}
              {new Date(monthly.until).toLocaleString('zh-CN', { timeZone: monthly.timeZone, hour12: false })}
              {' · '}
              {monthly.timeZone}。当前保留记录，不作为完整账单。
            </small>
          </>
        )}
      </section>
    </div>
  );
}
function Stat({
  title,
  value,
  note,
  missing = '暂未获取',
}: {
  title: string;
  value: number | undefined;
  note: string;
  missing?: string;
}) {
  return (
    <div className="admin-stat">
      <span>{title}</span>
      <strong>{value === undefined ? '—' : value.toLocaleString('zh-CN')}</strong>
      <small>{value === undefined ? missing : note}</small>
    </div>
  );
}
